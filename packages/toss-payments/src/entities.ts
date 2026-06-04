import type { Entity } from "@emulators/core";

export interface TossMerchant extends Entity {
  client_key: string;
  secret_key: string;
}

export type TossPaymentStatus =
  | "READY"
  | "IN_PROGRESS"
  | "DONE"
  | "CANCELED"
  | "PARTIAL_CANCELED"
  | "ABORTED"
  | "EXPIRED";

export interface TossCancel {
  transactionKey: string;
  cancelReason: string;
  canceledAt: string;
  cancelAmount: number;
  refundableAmount: number;
  cancelStatus: "DONE";
}

export interface TossCard {
  issuerCode: string;
  acquirerCode: string;
  number: string;
  installmentPlanMonths: number;
  isInterestFree: boolean;
  approveNo: string;
  cardType: string;
  ownerType: string;
  acquireStatus: string;
  amount: number;
}

export interface TossPayment extends Entity {
  payment_key: string;
  order_id: string;
  order_name: string;
  status: TossPaymentStatus;
  method: string;
  total_amount: number;
  balance_amount: number;
  requested_at: string;
  approved_at: string | null;
  last_transaction_key: string | null;
  use_escrow: boolean;
  culture_expense: boolean;
  cancels: TossCancel[] | null;
  card: TossCard | null;
}
