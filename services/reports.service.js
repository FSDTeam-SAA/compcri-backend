import User from '../models/User.js';
import Coupon from '../models/Coupon.js';
import CouponRedemption from '../models/CouponRedemption.js';
import { RevenueCatEvent, Subscription } from '../models/Subscription.js';
import { parsePagination, paginationMeta } from '../utils/pagination.js';
import { DAY_MS, bucketOf, resolveRange } from '../utils/range.js';

/// What each stored RevenueCat event means for the books. Read straight from
/// the saved webhook payload, so events received before this report existed
/// are classified the same way as new ones.
const classified = (match, includeSandbox) => [
  { $match: match },
  { $addFields: { ev: { $ifNull: ['$payload.event', '$payload'] } } },
  ...(includeSandbox ? [] : [{ $match: { 'ev.environment': { $ne: 'SANDBOX' } } }]),
  { $addFields: {
    local: { $divide: [{ $ifNull: ['$priceMinor', 0] }, 100] },
    takehome: { $convert: { input: '$ev.takehome_percentage', to: 'double', onError: null, onNull: null } }
  } },
  // RevenueCat sends every price in USD as well; a USD payment without it is
  // its own USD amount.
  { $addFields: {
    usd: { $convert: { input: { $ifNull: ['$ev.price', { $cond: [{ $eq: ['$currency', 'USD'] }, '$local', null] }] }, to: 'double', onError: 0, onNull: 0 } }
  } },
  { $addFields: {
    kind: { $switch: {
      branches: [
        { case: { $eq: ['$type', 'INITIAL_PURCHASE'] }, then: { $cond: [{ $eq: ['$ev.period_type', 'TRIAL'] }, 'TRIAL_START', 'NEW'] } },
        { case: { $eq: ['$type', 'NON_RENEWING_PURCHASE'] }, then: 'NEW' },
        { case: { $eq: ['$type', 'RENEWAL'] }, then: { $cond: [{ $eq: ['$ev.is_trial_conversion', true] }, 'TRIAL_CONVERSION', 'RENEWAL'] } },
        { case: { $and: [{ $eq: ['$type', 'CANCELLATION'] }, { $or: [{ $lt: ['$usd', 0] }, { $lt: ['$local', 0] }] }] }, then: 'REFUND' },
        { case: { $eq: ['$type', 'CANCELLATION'] }, then: 'CANCELLATION' },
        { case: { $eq: ['$type', 'EXPIRATION'] }, then: 'EXPIRATION' },
        { case: { $eq: ['$type', 'BILLING_ISSUE'] }, then: 'BILLING_ISSUE' },
        { case: { $eq: ['$type', 'PRODUCT_CHANGE'] }, then: 'PRODUCT_CHANGE' }
      ],
      default: 'OTHER'
    } }
  } },
  { $addFields: { paid: { $and: [{ $in: ['$kind', ['NEW', 'RENEWAL', 'TRIAL_CONVERSION']] }, { $gt: ['$local', 0] }] }, refund: { $eq: ['$kind', 'REFUND'] } } }
];

const money = (field) => ({
  gross: { $sum: { $cond: ['$paid', field, 0] } },
  refunds: { $sum: { $cond: ['$refund', { $abs: field }, 0] } },
  proceeds: { $sum: { $cond: ['$paid', { $multiply: [field, { $ifNull: ['$takehome', 0] }] }, { $cond: ['$refund', { $multiply: [{ $abs: field }, -1, { $ifNull: ['$takehome', 0] }] }, 0] }] } },
  transactions: { $sum: { $cond: ['$paid', 1, 0] } },
  missingTakehome: { $sum: { $cond: [{ $and: [{ $or: ['$paid', '$refund'] }, { $eq: ['$takehome', null] }] }, 1, 0] } }
});

const cents = (value) => Math.round((value || 0) * 100) / 100;

const finish = ({ gross, refunds, proceeds, transactions, missingTakehome }) => ({
  gross: cents(gross),
  refunds: cents(refunds),
  net: cents(gross - refunds),
  // Store fees and tax are only known per transaction from RevenueCat's
  // take-home percentage; without it for every row the estimate is partial.
  proceeds: missingTakehome ? null : cents(proceeds),
  transactions
});

const monthlyPrice = (row) => {
  const days = row.purchasedAt && row.expiresAt ? (row.expiresAt - row.purchasedAt) / DAY_MS : /year|annual/i.test(row.productId || '') ? 365 : 30.4375;
  return row.price * 30.4375 / Math.max(days, 1);
};

/// Recurring revenue from subscriptions that are paid up right now, each at
/// the price of its latest payment spread over its billing period.
const recurringRevenue = async (includeSandbox) => {
  const now = new Date();
  const [active, trials] = await Promise.all([
    Subscription.find({ status: { $in: ['ACTIVE', 'GRACE', 'CANCELLED'] }, expiresAt: { $gt: now } }).select('appUserId status').lean(),
    Subscription.countDocuments({ status: 'TRIAL', expiresAt: { $gt: now } })
  ]);
  if (!active.length) return { mrrUsd: 0, arrUsd: 0, activePaidSubscriptions: 0, cancellingSubscriptions: 0, activeTrials: trials };
  const latest = await RevenueCatEvent.aggregate([
    ...classified({ appUserId: { $in: active.map((row) => row.appUserId) }, type: { $in: ['INITIAL_PURCHASE', 'RENEWAL', 'NON_RENEWING_PURCHASE'] } }, includeSandbox),
    { $match: { paid: true } },
    { $sort: { eventAt: -1, _id: -1 } },
    { $group: { _id: '$appUserId', price: { $first: '$usd' }, purchasedAt: { $first: '$ev.purchased_at_ms' }, expiresAt: { $first: '$ev.expiration_at_ms' }, productId: { $first: '$productId' } } }
  ]);
  const paying = new Set(latest.map((row) => row._id));
  const mrr = latest.reduce((total, row) => total + monthlyPrice(row), 0);
  return {
    mrrUsd: cents(mrr),
    arrUsd: cents(mrr * 12),
    activePaidSubscriptions: latest.length,
    cancellingSubscriptions: active.filter((row) => row.status === 'CANCELLED' && paying.has(row.appUserId)).length,
    activeTrials: trials
  };
};

/// Influencer codes over the window: conversions when the purchase happened,
/// money when it was paid. Refunded payments drop out of revenue and
/// commission.
const influencerReport = async (start, end, includeSandbox) => {
  const environment = includeSandbox ? {} : { environment: 'PRODUCTION' };
  const live = { $eq: [{ $ifNull: ['$refundedAt', null] }, null] };
  const [completed, paid] = await Promise.all([
    CouponRedemption.aggregate([
      { $match: { status: 'COMPLETED', completedAt: { $gte: start, $lte: end }, ...environment } },
      { $group: { _id: '$couponId', redemptions: { $sum: 1 } } }
    ]),
    CouponRedemption.aggregate([
      { $match: { paidAt: { $gte: start, $lte: end }, ...environment } },
      { $group: {
        _id: '$couponId',
        payments: { $sum: { $cond: [live, 1, 0] } },
        revenueUsd: { $sum: { $cond: [live, '$revenueUsd', 0] } },
        discountUsd: { $sum: { $cond: [live, '$discountUsd', 0] } },
        commissionUsd: { $sum: { $cond: [live, '$commissionUsd', 0] } },
        refunds: { $sum: { $cond: [live, 0, 1] } }
      } }
    ])
  ]);
  const ids = [...new Set([...completed, ...paid].map((row) => row._id.toString()))];
  const coupons = await Coupon.find({ _id: { $in: ids } }).select('name email code commissionRate deletedAt').lean();
  const rows = coupons.map((coupon) => {
    const id = coupon._id.toString();
    const done = completed.find((row) => row._id.toString() === id);
    const money = paid.find((row) => row._id.toString() === id);
    return {
      couponId: id, name: coupon.name, email: coupon.email, code: coupon.code, commissionRate: coupon.commissionRate, deleted: Boolean(coupon.deletedAt),
      redemptions: done?.redemptions || 0,
      payments: money?.payments || 0,
      refunds: money?.refunds || 0,
      revenueUsd: cents(money?.revenueUsd),
      discountUsd: cents(money?.discountUsd),
      commissionUsd: cents(money?.commissionUsd)
    };
  }).sort((a, b) => b.revenueUsd - a.revenueUsd || b.redemptions - a.redemptions);
  return {
    rows,
    totals: rows.reduce((sum, row) => ({
      redemptions: sum.redemptions + row.redemptions,
      revenueUsd: cents(sum.revenueUsd + row.revenueUsd),
      discountUsd: cents(sum.discountUsd + row.discountUsd),
      commissionUsd: cents(sum.commissionUsd + row.commissionUsd)
    }), { redemptions: 0, revenueUsd: 0, discountUsd: 0, commissionUsd: 0 })
  };
};

export const financialReport = async (query) => {
  const { start, end, unit } = resolveRange(query);
  const includeSandbox = Boolean(query.includeSandbox);
  const base = classified({ eventAt: { $gte: start, $lte: end } }, includeSandbox);
  const [[totals], byCurrency, counts, series, seriesByCurrency, byProduct, byStore, byCountry, recurring, influencers] = await Promise.all([
    RevenueCatEvent.aggregate([...base, { $group: { _id: null, ...money('$usd') } }]),
    RevenueCatEvent.aggregate([...base, { $match: { $or: [{ paid: true }, { refund: true }] } }, { $group: { _id: '$currency', ...money('$local') } }, { $sort: { gross: -1 } }]),
    RevenueCatEvent.aggregate([...base, { $group: { _id: '$kind', count: { $sum: 1 } } }]),
    RevenueCatEvent.aggregate([...base, { $match: { $or: [{ paid: true }, { refund: true }] } }, { $group: { _id: bucketOf('$eventAt', unit), ...money('$usd') } }, { $sort: { _id: 1 } }]),
    RevenueCatEvent.aggregate([...base, { $match: { $or: [{ paid: true }, { refund: true }] } }, { $group: { _id: { bucket: bucketOf('$eventAt', unit), currency: '$currency' }, ...money('$local') } }, { $sort: { '_id.bucket': 1 } }]),
    RevenueCatEvent.aggregate([...base, { $match: { $or: [{ paid: true }, { refund: true }] } }, { $group: { _id: { productId: '$productId', store: '$ev.store' }, ...money('$usd') } }, { $sort: { gross: -1 } }]),
    RevenueCatEvent.aggregate([...base, { $match: { $or: [{ paid: true }, { refund: true }] } }, { $group: { _id: '$ev.store', ...money('$usd') } }, { $sort: { gross: -1 } }]),
    RevenueCatEvent.aggregate([...base, { $match: { $or: [{ paid: true }, { refund: true }] } }, { $group: { _id: '$ev.country_code', ...money('$usd') } }, { $sort: { gross: -1 } }, { $limit: 15 }]),
    recurringRevenue(includeSandbox),
    influencerReport(start, end, includeSandbox)
  ]);
  const count = (kind) => counts.find((row) => row._id === kind)?.count || 0;
  return {
    range: { from: start, to: end, unit },
    includeSandbox,
    totalsUsd: finish(totals || { gross: 0, refunds: 0, proceeds: 0, transactions: 0, missingTakehome: 0 }),
    byCurrency: byCurrency.map((row) => ({ currency: row._id || 'USD', ...finish(row) })),
    activity: {
      newPurchases: count('NEW'),
      renewals: count('RENEWAL'),
      trialStarts: count('TRIAL_START'),
      trialConversions: count('TRIAL_CONVERSION'),
      cancellations: count('CANCELLATION'),
      refunds: count('REFUND'),
      expirations: count('EXPIRATION'),
      billingIssues: count('BILLING_ISSUE')
    },
    series: series.map((row) => ({ bucket: row._id, ...finish(row) })),
    seriesByCurrency: seriesByCurrency.map((row) => ({ bucket: row._id.bucket, currency: row._id.currency || 'USD', ...finish(row) })),
    byProduct: byProduct.map((row) => ({ productId: row._id.productId || 'Unknown', store: row._id.store || 'UNKNOWN', ...finish(row) })),
    byStore: byStore.map((row) => ({ store: row._id || 'UNKNOWN', ...finish(row) })),
    byCountry: byCountry.map((row) => ({ country: row._id || 'Unknown', ...finish(row) })),
    recurring,
    influencers
  };
};

export const TRANSACTION_KINDS = ['NEW', 'RENEWAL', 'TRIAL_START', 'TRIAL_CONVERSION', 'REFUND', 'CANCELLATION', 'EXPIRATION', 'BILLING_ISSUE', 'PRODUCT_CHANGE', 'OTHER'];

const transactionRows = async (query, { skip = 0, limit }) => {
  const { start, end } = resolveRange(query);
  const pipeline = [
    ...classified({ eventAt: { $gte: start, $lte: end } }, Boolean(query.includeSandbox)),
    ...(query.kind ? [{ $match: { kind: query.kind } }] : [{ $match: { kind: { $ne: 'OTHER' } } }]),
    { $sort: { eventAt: -1 } }
  ];
  const [result] = await RevenueCatEvent.aggregate([
    ...pipeline,
    { $facet: {
      items: [{ $skip: skip }, ...(limit ? [{ $limit: limit }] : []), { $project: { payload: 0 } }],
      total: [{ $count: 'count' }]
    } }
  ]).option({ allowDiskUse: true });
  const users = await User.find({ revenueCatAppUserId: { $in: [...new Set(result.items.map((row) => row.appUserId))] } })
    .select('displayName email contactCode revenueCatAppUserId').lean();
  const byAppUserId = new Map(users.map((user) => [user.revenueCatAppUserId, user]));
  return {
    total: result.total[0]?.count || 0,
    items: result.items.map((row) => {
      const user = byAppUserId.get(row.appUserId);
      return {
        id: row.eventId,
        at: row.eventAt,
        kind: row.kind,
        type: row.type,
        productId: row.productId,
        store: row.ev.store,
        environment: row.ev.environment || 'PRODUCTION',
        amount: cents(row.local),
        currency: row.currency || 'USD',
        amountUsd: cents(row.usd),
        takehomePercentage: row.takehome,
        country: row.ev.country_code,
        transactionId: row.ev.transaction_id,
        user: user ? { _id: user._id, displayName: user.displayName, email: user.email, contactCode: user.contactCode } : null
      };
    })
  };
};

export const listTransactions = async (query) => {
  const { page, limit, skip } = parsePagination(query);
  const { items, total } = await transactionRows(query, { skip, limit });
  return { items, meta: paginationMeta(page, limit, total) };
};

const csvCell = (value) => {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  // A leading = + - @ would run as a formula when the file opens in Excel.
  const safe = /^[=+\-@]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

export const transactionsCsv = async (query) => {
  const { items } = await transactionRows(query, { limit: 50_000 });
  const header = ['Date (UTC)', 'Type', 'Customer', 'Email', 'Product', 'Store', 'Environment', 'Amount', 'Currency', 'Amount (USD)', 'Take-home %', 'Country', 'Transaction ID', 'Event ID'];
  const lines = items.map((row) => [
    row.at, row.kind, row.user?.displayName, row.user?.email, row.productId, row.store, row.environment,
    row.amount, row.currency, row.amountUsd, row.takehomePercentage === null || row.takehomePercentage === undefined ? '' : Math.round(row.takehomePercentage * 1000) / 10,
    row.country, row.transactionId, row.id
  ].map(csvCell).join(','));
  return [header.join(','), ...lines].join('\r\n');
};
