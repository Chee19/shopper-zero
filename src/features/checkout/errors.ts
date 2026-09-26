import { AppError } from "@/shared/errors";
import type { ApiErrorCode } from "@/contracts/api";
export class CheckoutError extends AppError {
  private readonly httpStatus?: number;
  constructor(code: ApiErrorCode, message: string, status?: number) {
    super(code, message);
    this.name = "CheckoutError";
    this.httpStatus = status;
  }
  override get status(): number { return this.httpStatus ?? super.status; }
}
