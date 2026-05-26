import {
  CriterionModifier,
  VrMode,
} from "src/core/generated-graphql";
import { CriterionType } from "../types";
import {
  ModifierCriterionOption,
  MultiStringCriterion,
} from "./criterion";

// Display labels for each VR mode value
export const vrModeStrings = ["180° LR", "360° TB", "360° Mono"];

function stringToVRMode(s: string): VrMode | undefined {
  switch (s) {
    case "180° LR":
      return VrMode.Lr180;
    case "360° TB":
      return VrMode.Tb360;
    case "360° Mono":
      return VrMode.Mono360;
  }
}

export class VRModeCriterion extends MultiStringCriterion {
  public toCriterionInput() {
    return {
      value: this.value
        .map((v) => stringToVRMode(v))
        .filter((v): v is VrMode => v !== undefined),
      modifier: this.modifier,
    };
  }
}

class BaseVRModeCriterionOption extends ModifierCriterionOption {
  constructor(value: CriterionType) {
    super({
      messageID: "vr_mode",
      type: value,
      options: vrModeStrings,
      modifierOptions: [
        CriterionModifier.Includes,
        CriterionModifier.Excludes,
        CriterionModifier.IsNull,
        CriterionModifier.NotNull,
      ],
      defaultModifier: CriterionModifier.Includes,
      makeCriterion: () => new VRModeCriterion(this),
    });
  }
}

export const VRModeCriterionOption = new BaseVRModeCriterionOption("vr_mode");
