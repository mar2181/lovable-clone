import { Hono } from "hono";
import { Bindings, Variables } from "../index";
import { authMiddleware, ownerOnly } from "../middleware/auth";

const shareRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();

shareRouter.use("*", authMiddleware);
// Confused-deputy lockdown: sends via the shared Twilio account (SMS toll-fraud
// risk) and the operator's Telegram. Owner-only until per-tenant messaging exists.
shareRouter.use("*", ownerOnly);

type ShareChannel = "telegram" | "sms";

type ShareRequestBody = {
  projectId?: string;
  url?: string;
  channel?: ShareChannel;
  phone?: string;
  message?: string;
};

type ShareResult = {
  channel: ShareChannel;
  ok: boolean;
  detail?: string;
  providerId?: string;
};

async function sendTelegram(
  env: Bindings,
  text: string
): Promise<ShareResult> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_USER_ID;
  if (!token || !chatId) {
    return {
      channel: "telegram",
      ok: false,
      detail: "TELEGRAM_BOT_TOKEN or TELEGRAM_USER_ID missing in worker env",
    };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: false,
      }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      result?: { message_id: number };
      description?: string;
    };
    if (!res.ok || !data.ok) {
      return {
        channel: "telegram",
        ok: false,
        detail: data.description || `HTTP ${res.status}`,
      };
    }
    return {
      channel: "telegram",
      ok: true,
      providerId: data.result?.message_id?.toString(),
    };
  } catch (err) {
    return {
      channel: "telegram",
      ok: false,
      detail: (err as Error).message,
    };
  }
}

async function sendSms(
  env: Bindings,
  to: string,
  text: string
): Promise<ShareResult> {
  const sid = env.TWILIO_SID;
  const auth = env.TWILIO_AUTH_TOKEN;
  const from = env.TWILIO_FROM;
  if (!sid || !auth || !from) {
    return {
      channel: "sms",
      ok: false,
      detail:
        "TWILIO_SID, TWILIO_AUTH_TOKEN, or TWILIO_FROM missing in worker env",
    };
  }
  try {
    const body = new URLSearchParams({ To: to, From: from, Body: text });
    const credentials = btoa(`${sid}:${auth}`);
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      }
    );
    const data = (await res.json()) as {
      sid?: string;
      message?: string;
      code?: number;
    };
    if (!res.ok) {
      return {
        channel: "sms",
        ok: false,
        detail: `Twilio ${res.status}: ${data.message || "unknown error"}${
          data.code ? ` (code ${data.code})` : ""
        }`,
      };
    }
    return { channel: "sms", ok: true, providerId: data.sid };
  } catch (err) {
    return {
      channel: "sms",
      ok: false,
      detail: (err as Error).message,
    };
  }
}

function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

shareRouter.post("/phone", async (c) => {
  let body: ShareRequestBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { projectId, url, channel = "telegram", phone, message } = body;

  if (!projectId && !url) {
    return c.json({ error: "Provide projectId or url" }, 400);
  }

  // Build the share URL the recipient will tap on their phone. Frontend can
  // override by passing url= explicitly (handy when we know the editor host
  // we want to share).
  const shareUrl =
    url ||
    `${
      c.env.ALLOWED_ORIGINS?.split(",")[0]?.trim() ||
      "https://hswebappbuilder.space"
    }/editor/${projectId}`;

  const text =
    message ||
    `🚀 HS App Builder — preview\nOpen on your phone:\n${shareUrl}`;

  const results: ShareResult[] = [];

  if (channel === "telegram") {
    results.push(await sendTelegram(c.env, text));
  } else if (channel === "sms") {
    const to = phone
      ? normalizePhone(phone)
      : c.env.MARIO_PHONE
      ? normalizePhone(c.env.MARIO_PHONE)
      : null;
    if (!to) {
      return c.json(
        { error: "Missing phone number (pass phone= or set MARIO_PHONE)" },
        400
      );
    }
    results.push(await sendSms(c.env, to, text));
  } else {
    return c.json({ error: `Unknown channel: ${channel}` }, 400);
  }

  const ok = results.some((r) => r.ok);
  return c.json(
    {
      ok,
      shareUrl,
      results,
    },
    ok ? 200 : 502
  );
});

shareRouter.get("/health", (c) => {
  return c.json({
    ok: true,
    telegram: Boolean(c.env.TELEGRAM_BOT_TOKEN && c.env.TELEGRAM_USER_ID),
    sms: Boolean(
      c.env.TWILIO_SID && c.env.TWILIO_AUTH_TOKEN && c.env.TWILIO_FROM
    ),
  });
});

export default shareRouter;
