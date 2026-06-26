import { useContext } from "react";
import { ConfirmationContext, ConfirmationOptions } from "../components/feedback/ConfirmationProvider";

export const useConfirmation = () => {
  const ctx = useContext(ConfirmationContext);
  if (!ctx) {
    throw new Error("useConfirmation must be used inside <ConfirmationProvider>");
  }
  return ctx.confirm;
};

export type { ConfirmationOptions };
