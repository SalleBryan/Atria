/**
 * Why a message did not arrive, in words the desk can act on. The sender
 * stores the provider's own text for an administrator; screens keep it in a
 * tooltip and show this instead.
 */
export function plainReason(reason: string | null, channel: string): string | null {
  if (!reason) return null;
  const text = reason.toLowerCase();
  const address = channel === "SMS" ? "mobile number" : "email address";
  if (text.startsWith("no sms address") || text.startsWith("no email address")) return `No ${address} on file.`;
  if (text.includes("cancelled before the reminder")) return "Not sent: the visit was cancelled.";
  const moved = /^the appointment is (\w+)/.exec(text);
  if (moved?.[1]) return `Not sent: the visit was already ${moved[1].replace(/_/g, " ")}.`;
  if (text.includes("sandbox")) return "Not sent: the test system only reaches approved numbers and addresses.";
  if (text.includes("accessdenied") || text.includes("not authorized")) return "The system could not send it. Tell your administrator.";
  if (text.includes("not verified") || text.includes("rejected")) return `The ${address} refused it.`;
  if (text.includes("bounce")) return `The ${address} does not exist or is full.`;
  if (text.includes("throttl")) return "The sending service was busy and it did not go out.";
  if (text.includes("could not be rendered")) return "The message could not be put together. Tell your administrator.";
  if (channel === "SMS") return "The network did not deliver it. The phone may be off or out of reach.";
  return "It could not be sent.";
}
