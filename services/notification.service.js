import Notification from '../models/Notification.js';
import Device from '../models/Device.js';
import User from '../models/User.js';
import { sendMulticast } from './firebase.service.js';

const preferenceKey = {
  REMINDER: 'reminders',
  INVITATION: 'invitations',
  GROUP_UPDATE: 'groupUpdates',
  CONTACT_REQUEST: 'contactRequests',
  SECURITY: null,
  SUBSCRIPTION: 'subscriptionUpdates'
};

const titleTranslations = {
  pt: {
    'New contact request': 'Nova solicitação de contato', 'Group member joined': 'Novo membro no grupo',
    'Added to a group': 'Adicionado a um grupo', 'Group ownership transferred': 'Propriedade do grupo transferida',
    'Group invitation': 'Convite para grupo', 'Event shared with you': 'Evento compartilhado com você',
    'Calendar access granted': 'Acesso ao calendário concedido', 'Subscription updated': 'Assinatura atualizada',
    'Password changed': 'Senha alterada'
  },
  es: {
    'New contact request': 'Nueva solicitud de contacto', 'Group member joined': 'Nuevo miembro en el grupo',
    'Added to a group': 'Añadido a un grupo', 'Group ownership transferred': 'Propiedad del grupo transferida',
    'Group invitation': 'Invitación al grupo', 'Event shared with you': 'Evento compartido contigo',
    'Calendar access granted': 'Acceso al calendario concedido', 'Subscription updated': 'Suscripción actualizada',
    'Password changed': 'Contraseña cambiada'
  }
};

const translateBody = (locale, body) => {
  if (locale === 'pt') {
    if (body === 'Someone wants to add you as a contact') return 'Alguém quer adicionar você como contato';
    if (body === 'A new member joined your group') return 'Um novo membro entrou no seu grupo';
    if (body === 'You now have delegated access to a calendar') return 'Agora você tem acesso delegado a um calendário';
    if (body === 'Your subscription status changed') return 'O status da sua assinatura foi alterado';
    if (body === 'Your password was changed and other sessions were revoked') return 'Sua senha foi alterada e as outras sessões foram revogadas';
    if (body.startsWith('You were added to ')) return `Você foi adicionado(a) a ${body.slice(18)}`;
    if (body.startsWith('You now own ')) return `Agora você é proprietário(a) de ${body.slice(12)}`;
    if (body.startsWith('You were invited to ')) return `Você foi convidado(a) para ${body.slice(20)}`;
    if (body.startsWith('Event begins at ')) return `O evento começa em ${body.slice(16)}`;
  }
  if (locale === 'es') {
    if (body === 'Someone wants to add you as a contact') return 'Alguien quiere añadirte como contacto';
    if (body === 'A new member joined your group') return 'Un nuevo miembro se unió a tu grupo';
    if (body === 'You now have delegated access to a calendar') return 'Ahora tienes acceso delegado a un calendario';
    if (body === 'Your subscription status changed') return 'El estado de tu suscripción cambió';
    if (body === 'Your password was changed and other sessions were revoked') return 'Tu contraseña cambió y se revocaron las demás sesiones';
    if (body.startsWith('You were added to ')) return `Te añadieron a ${body.slice(18)}`;
    if (body.startsWith('You now own ')) return `Ahora eres propietario de ${body.slice(12)}`;
    if (body.startsWith('You were invited to ')) return `Te invitaron a ${body.slice(20)}`;
    if (body.startsWith('Event begins at ')) return `El evento comienza a las ${body.slice(16)}`;
  }
  return body;
};

export const deliverPush = async (notification) => {
  const user = await User.findById(notification.userId).select('notificationPreferences');
  if (!user?.notificationPreferences?.pushEnabled) return;
  const key = preferenceKey[notification.category];
  if (key && user.notificationPreferences[key] === false) return;
  const devices = await Device.find({ userId: notification.userId });
  if (!devices.length) return;
  const response = await sendMulticast({
    tokens: devices.map((item) => item.token),
    notification: { title: notification.title, body: notification.body },
    data: Object.fromEntries(Object.entries(notification.data || {}).map(([k, v]) => [k, String(v)]))
  });
  if (!response) return;
  const invalidTokens = response.responses
    .map((item, index) => ({ item, token: devices[index].token }))
    .filter(({ item }) => !item.success && ['messaging/invalid-registration-token', 'messaging/registration-token-not-registered'].includes(item.error?.code))
    .map(({ token }) => token);
  if (invalidTokens.length) await Device.deleteMany({ token: { $in: invalidTokens } });
};

export const createNotification = async (userId, category, title, body, data = {}) => {
  const recipient = await User.findById(userId).select('locale');
  const locale = recipient?.locale || 'en';
  const notification = await Notification.create({
    userId,
    category,
    title: titleTranslations[locale]?.[title] || title,
    body: translateBody(locale, body),
    data
  });
  import('../jobs/agenda.js')
    .then(({ enqueueJob }) => enqueueJob('deliver-notification', { notificationId: notification._id.toString() }))
    .catch(() => undefined);
  return notification;
};
