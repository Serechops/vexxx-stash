import {
  StringBooleanCriterion,
  StringBooleanCriterionOption,
} from "./criterion";

export const HasSegmentsCriterionOption = new StringBooleanCriterionOption(
  "hasSegments",
  "has_segments",
  () => new HasSegmentsCriterion()
);

export class HasSegmentsCriterion extends StringBooleanCriterion {
  constructor() {
    super(HasSegmentsCriterionOption);
  }
}
