import { CriterionModifier } from "src/core/generated-graphql";
import { ModifierCriterion } from "./criteria/criterion";
import { IStashIDValue } from "./types";
import { ListFilterModel } from "./filter";

export function filterByStashID(filter: ListFilterModel, stashID: string) {
  const stashCriterion = filter.makeCriterion(
    "stash_id_endpoint"
  ) as ModifierCriterion<IStashIDValue>;
  stashCriterion.modifier = CriterionModifier.Equals;
  stashCriterion.value = { endpoint: "", stashID: stashID.trim() };
  filter.criteria = [stashCriterion];
}
