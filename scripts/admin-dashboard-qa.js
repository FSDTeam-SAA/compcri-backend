// Disposable local browser QA. Uses an in-memory database and no production credentials.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
const replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
Object.assign(process.env, { NODE_ENV:'test', DISABLE_JOBS:'true', PAYWALL_ENABLED:'true', MONGODB_URI:replset.getUri('dashboard-qa'), JWT_ACCESS_SECRET:'dashboard-qa-access-secret-long-enough-123', JWT_REFRESH_SECRET:'dashboard-qa-refresh-secret-long-enough-456', CORS_ORIGINS:'http://localhost:3007', SMTP_HOST:'',SMTP_USER:'',SMTP_PASS:'', CLOUDINARY_CLOUD_NAME:'',CLOUDINARY_API_KEY:'',CLOUDINARY_API_SECRET:'', OPENAI_API_KEY:'',GEMINI_API_KEY:'', FIREBASE_PROJECT_ID:'',FIREBASE_CLIENT_EMAIL:'',FIREBASE_PRIVATE_KEY:'',REVENUECAT_SECRET_API_KEY:'' });
const {connectDatabase,disconnectDatabase}=await import('../config/database.js');await connectDatabase();
const models=await import('../models/index.js');const {default:Coupon}=await import('../models/Coupon.js');const {hashPassword}=await import('../services/auth.service.js');
const now=new Date();const year=now.getUTCFullYear();
const admin=await models.User.create({email:'admin@example.test',passwordHash:await hashPassword('DashboardQA123!'),role:'ADMIN',firstName:'Rifat',lastName:'Hossain',displayName:'Rifat Hossain',contactCode:'ADMIN-100-AA',revenueCatAppUserId:'qa-admin'});
const names=['Akah Larry','Yvan Ndeme','Nde Michael','Vicky Djoulako','Emily Carter','Sophia Turner','Olivia Smith','Ava Johnson','Mia Wilson','Sarah Martinez','James Thompson','Emily Chen','Michael Johnson','Lisa Patel','David Lee','Anna Kim','Robert Garcia','Isaac Fomo','Liam Brown','Noah Davis'];
const members=await models.User.create(names.map((name,i)=>({email:'member'+i+'@example.test',displayName:name,contactCode:'QA-'+(100+i)+'-FA',revenueCatAppUserId:'qa-member-'+i,plan:i%3?'PREMIUM':'FREE',status:i%4===2?'SUSPENDED':'ACTIVE',phone:'+88 024 3456',profession:'English Professor',country:'France',city:'Paris',interests:['Technology','Music','Travel'],createdAt:new Date(year,i%12,1+(i%27))})));
await models.RevenueCatEvent.create(Array.from({length:12},(_,i)=>({eventId:'qa-event-'+i,appUserId:'qa-member-1',type:'RENEWAL',priceMinor:[50000,135000,150000,112000,110000,165000,210000,230000,200000,150000,200000,200000][i],currency:'USD',eventAt:new Date(year,i,2),payload:{qa:true}})));
await models.Subscription.create(members.filter(u=>u.plan==='PREMIUM').map((u,i)=>({userId:u._id,appUserId:u.revenueCatAppUserId,status:'ACTIVE',productId:i%2?'premium_yearly':'premium_monthly'})));
await models.AuditLog.create(members.slice(0,15).map((u,i)=>({actorId:u._id,action:i%3?'USER_REGISTERED':'USER_PREMIUM',createdAt:new Date(Date.now()-i*300000)})));
await Coupon.create(names.slice(0,12).map((name,i)=>({name,email:'influencer'+i+'@example.test',code:'SARAH-'+(456+i)+'-FA',discountType:i%2?'FIXED':'PERCENTAGE',discountValue:i%2?20:15,commissionRate:10,startDate:new Date(Date.now()-86400000),endDate:new Date(Date.now()+(i%3===2?-1:1)*86400000),totalUsageLimit:50,perUserLimit:1,redemptions:20,revenue:5000,discountGiven:100,commission:500,createdBy:admin._id})));

// Usage, store payments and influencer redemptions for the analytics and report pages.
const day=86400000;const today=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());
await models.AppInstall.create(Array.from({length:60},(_,i)=>({installId:'qa-install-'+String(i).padStart(10,'0'),platform:i%3?'IOS':'ANDROID',appVersion:i%4?'1.4.0':'1.3.2',firstOpenedAt:new Date(today-(i%40)*day+3600000),lastOpenedAt:new Date(today-(i%9)*day+7200000),opens:3+i%7,userId:members[i%members.length]._id,preexisting:i>52})));
await models.UserActivity.create(members.flatMap((u,i)=>Array.from({length:(i%7)+1},(_,d)=>({userId:u._id,day:new Date(today-d*(1+i%3)*day),platform:i%3?'IOS':'ANDROID',appVersion:'1.4.0',activeWindows:2+((i+d)%9),firstSeenAt:new Date(today-d*day+3600000),lastSeenAt:new Date(today-d*day+5400000)}))));
await models.User.updateMany({role:'USER'},{$set:{lastActiveAt:new Date(Date.now()-2*3600000)}});
await models.User.updateOne({email:'member3@example.test'},{$set:{lastActiveAt:new Date(Date.now()-45*day)}});
const rc=(i,type,price,extra={})=>{const at=Date.now()-(i%25)*day-3600000;const event={id:'qa-rc-'+i,type,app_user_id:'qa-member-'+(i%20),environment:extra.environment||'PRODUCTION',store:i%4?'APP_STORE':'PLAY_STORE',product_id:i%3?'premium_monthly':'premium_yearly',price,price_in_purchased_currency:extra.local??price,currency:extra.currency||'USD',takehome_percentage:0.85,country_code:extra.country||['US','GB','BR','PT','ES'][i%5],event_timestamp_ms:at,purchased_at_ms:at,expiration_at_ms:at+(i%3?30:365)*day,period_type:extra.period_type||'NORMAL',is_trial_conversion:extra.conversion||false,original_transaction_id:'qa-txn-'+i};return {eventId:event.id,appUserId:event.app_user_id,type,productId:event.product_id,platform:event.store,priceMinor:Math.round((extra.local??price)*100),currency:event.currency,eventAt:new Date(at),payload:{api_version:'1.0',event}};};
await models.RevenueCatEvent.create([
 ...Array.from({length:14},(_,i)=>rc(100+i,'INITIAL_PURCHASE',0,{period_type:'TRIAL'})),
 ...Array.from({length:9},(_,i)=>rc(200+i,'RENEWAL',i%3?8.99:79.99,{conversion:true})),
 ...Array.from({length:12},(_,i)=>rc(300+i,'RENEWAL',i%3?8.99:79.99)),
 rc(400,'RENEWAL',9.8,{currency:'BRL',local:49.9,country:'BR'}),rc(401,'RENEWAL',9.8,{currency:'BRL',local:49.9,country:'BR'}),
 rc(402,'CANCELLATION',-8.99),rc(403,'CANCELLATION',0),rc(404,'EXPIRATION',0),rc(405,'BILLING_ISSUE',0),
 rc(406,'INITIAL_PURCHASE',8.99,{environment:'SANDBOX'})
]);
const live=await Coupon.find().sort({createdAt:1}).limit(3);
await Coupon.updateMany({_id:{$in:live.slice(0,2).map(c=>c._id)}},{$set:{offeringId:'influencer_20'}});
await models.CouponRedemption.create(live.slice(0,2).flatMap((c,j)=>Array.from({length:4},(_,i)=>({couponId:c._id,userId:members[i+j*4]._id,code:c.code,offeringId:'influencer_20',status:i===3?'APPLIED':'COMPLETED',environment:'PRODUCTION',appliedAt:new Date(Date.now()-(i+2)*day),completedAt:i===3?undefined:new Date(Date.now()-(i+1)*day),paidAt:i<2?new Date(Date.now()-i*day):undefined,revenueUsd:i<2?7.19:0,discountUsd:i<2?1.8:0,commissionUsd:i<2?0.72:0}))));
await models.AuditLog.create(members.slice(0,6).flatMap((u,i)=>[{actorId:u._id,action:'COUPON_APPLIED',metadata:{code:'SARAH-456-FA'},createdAt:new Date(Date.now()-i*7200000)},{actorId:u._id,action:'SUBSCRIPTION_STARTED',targetType:'Subscription',metadata:{productId:'premium_monthly',price:0,currency:'USD',trial:true},createdAt:new Date(Date.now()-i*7000000)}]));
const {default:app}=await import('../app.js');
const server=app.listen(5508,'127.0.0.1',()=>process.stdout.write('Disposable dashboard QA API ready at http://localhost:5508/api/v1\n'));
async function stop(){server.close();await disconnectDatabase();await replset.stop();process.exit(0);}process.on('SIGINT',stop);process.on('SIGTERM',stop);
