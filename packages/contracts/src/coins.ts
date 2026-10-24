import { z } from "zod";
import { PageCursorSchema, UserSummarySchema } from "./social.js";

export const coinRules = {
  dailyAmount: "100",
  timeZone: "Asia/Dushanbe",
} as const;
// Decimal strings preserve integer precision across JSON and browser clients.
export const CoinAmountSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,18})$/)
  .refine((value) => value.length < 19 || value <= "9223372036854775807");
export const CoinWalletSchema = z.strictObject({
  balance: CoinAmountSchema,
  serverTime: z.iso.datetime(),
  dailyReward: z.strictObject({
    amount: z.literal(coinRules.dailyAmount),
    timeZone: z.literal(coinRules.timeZone),
    claimed: z.boolean(),
    nextClaimAt: z.iso.datetime(),
  }),
});
export const CoinWalletResponseSchema = z.strictObject({
  wallet: CoinWalletSchema,
});
export const CoinGiftReceiptSchema = z.strictObject({
  id: z.uuid(),
  amount: CoinAmountSchema.refine((value) => value !== "0"),
  senderId: z.uuid(),
  recipientId: z.uuid(),
  streamId: z.uuid(),
  giftKey: z.string().min(1).max(80),
  createdAt: z.iso.datetime(),
});
export const CoinTransactionSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(["daily_reward", "gift_sent", "gift_received"]),
  amount: CoinAmountSchema.refine((value) => value !== "0"),
  balanceAfter: CoinAmountSchema,
  createdAt: z.iso.datetime(),
  counterparty: UserSummarySchema.nullable(),
  gift: z
    .strictObject({ streamId: z.uuid(), giftKey: z.string().min(1).max(80) })
    .nullable(),
});
export const CoinTransactionsResponseSchema = z.strictObject({
  items: z.array(CoinTransactionSchema),
  nextCursor: PageCursorSchema.nullable(),
});
export const CoinClaimResponseSchema = z.strictObject({
  credited: z.boolean(),
  wallet: CoinWalletSchema,
  transaction: CoinTransactionSchema,
});
export type CoinWallet = z.infer<typeof CoinWalletSchema>;
export type CoinTransaction = z.infer<typeof CoinTransactionSchema>;
export type CoinGiftReceipt = z.infer<typeof CoinGiftReceiptSchema>;
export const coinsEndpoints = {
  wallet: { method: "GET", path: "/api/v1/coins/wallet", successStatus: 200 },
  claim: {
    method: "POST",
    path: "/api/v1/coins/daily-claim",
    successStatus: 200,
  },
  transactions: {
    method: "GET",
    path: "/api/v1/coins/transactions",
    successStatus: 200,
  },
} as const;
