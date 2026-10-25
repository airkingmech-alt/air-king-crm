import type {Row} from "./core";
// A grant belongs to exactly one message and its first dispatch attempt. A 429
// retry follows normal quiet hours; the original request cannot renew the grant.
export function hasSmsSendNowGrant(message:Row, now=new Date(), claimed=false) {
  const requested=Date.parse(message.send_now_requested_at), expires=Date.parse(message.send_now_expires_at);
  return message.channel==="sms" && message.category==="transactional" && !message.campaign_id &&
    !!message.send_now_actor_id && Number(message.attempts || 0)===(claimed?1:0) &&
    Number.isFinite(requested) && Number.isFinite(expires) && requested<=now.getTime() &&
    expires>now.getTime() && expires-requested<=5*60000;
}
