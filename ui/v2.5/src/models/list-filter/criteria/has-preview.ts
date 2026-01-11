import { BooleanCriterion, BooleanCriterionOption } from "./criterion";

export const HasPreviewCriterionOption = new BooleanCriterionOption(
    "has_preview",
    "has_preview",
    () => new HasPreviewCriterion()
);

export class HasPreviewCriterion extends BooleanCriterion {
    constructor() {
        super(HasPreviewCriterionOption);
    }
}
