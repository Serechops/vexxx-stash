import { BooleanCriterion, BooleanCriterionOption } from "./criterion";

export const FunscriptCriterionOption = new BooleanCriterionOption(
  "has_funscript",
  "has_funscript",
  () => new FunscriptCriterion()
);

export class FunscriptCriterion extends BooleanCriterion {
  constructor() {
    super(FunscriptCriterionOption);
  }
}
