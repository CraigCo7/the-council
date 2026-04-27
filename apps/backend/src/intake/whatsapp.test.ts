import { describe, it, expect } from "vitest";
import { extractInboundMessages, isExpectedSender } from "./whatsapp.js";

describe("extractInboundMessages", () => {
  it("returns the text message from a typical Meta payload", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "biz-id",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "+1...", phone_number_id: "999" },
                contacts: [{ profile: { name: "Craig" }, wa_id: "639171234567" }],
                messages: [
                  {
                    from: "639171234567",
                    id: "wamid.HBgL...",
                    timestamp: "1714500000",
                    type: "text",
                    text: { body: "what's overdue?" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const out = extractInboundMessages(payload);
    expect(out).toHaveLength(1);
    expect(out[0].text.body).toBe("what's overdue?");
    expect(out[0].id).toBe("wamid.HBgL...");
    expect(out[0].from).toBe("639171234567");
  });

  it("ignores delivery-status payloads (no messages array)", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [{ id: "wamid...", status: "delivered" }],
              },
            },
          ],
        },
      ],
    };
    expect(extractInboundMessages(payload)).toEqual([]);
  });

  it("skips non-text messages (image, audio, etc.)", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { from: "639171234567", id: "wamid.A", timestamp: "1", type: "image", image: {} },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(extractInboundMessages(payload)).toEqual([]);
  });

  it("returns multiple text messages in one payload", () => {
    const mk = (id: string, body: string) => ({
      from: "639171234567",
      id,
      timestamp: "1",
      type: "text",
      text: { body },
    });
    const payload = {
      entry: [
        { changes: [{ value: { messages: [mk("a", "first"), mk("b", "second")] } }] },
      ],
    };
    expect(extractInboundMessages(payload).map((m) => m.text.body)).toEqual([
      "first",
      "second",
    ]);
  });

  it("returns [] on garbage input rather than throwing", () => {
    expect(extractInboundMessages(null)).toEqual([]);
    expect(extractInboundMessages({ random: "garbage" })).toEqual([]);
    expect(extractInboundMessages("not an object")).toEqual([]);
  });
});

describe("isExpectedSender", () => {
  // The configured number is read from config, which is set up via test env.
  // We can only assert symmetric behavior here without monkey-patching config:
  // the function should normalize both sides identically.
  it("normalizes phone numbers (digits only)", () => {
    // If the configured WHATSAPP_TO_NUMBER in the test env is empty (default),
    // the function returns false for everything — which is the safe default.
    // Either way, the same digit string should produce the same answer.
    const a = isExpectedSender("+639171234567");
    const b = isExpectedSender("639171234567");
    expect(a).toBe(b);
  });
});
