import React, { useState } from "react";
import { Button, Box, Grid, IconButton, Typography, Stack } from "@mui/material";
import { FormattedMessage, useIntl } from "react-intl";
import { IconDefinition } from "@fortawesome/fontawesome-svg-core";

import { LoadingIndicator } from "../Shared/LoadingIndicator";
import { Icon } from "../Shared/Icon";
import { ModalComponent } from "../Shared/Modal";
import { TruncatedText } from "../Shared/TruncatedText";
import * as GQL from "src/core/generated-graphql";
import { stringToGender } from "src/utils/gender";
import { getCountryByISO } from "src/utils/country";
import {
  faArrowLeft,
  faArrowRight,
  faCheck,
  faExternalLinkAlt,
  faTimes,
} from "@fortawesome/free-solid-svg-icons";
import { ExternalLink } from "../Shared/ExternalLink";

interface IPerformerModalProps {
  performer: GQL.ScrapedScenePerformerDataFragment;
  modalVisible: boolean;
  closeModal: () => void;
  onSave: (input: GQL.PerformerCreateInput) => void;
  excludedPerformerFields?: string[];
  header: string;
  icon: IconDefinition;
  create?: boolean;
  endpoint?: string;
}

const PerformerModal: React.FC<IPerformerModalProps> = ({
  modalVisible,
  performer,
  onSave,
  closeModal,
  excludedPerformerFields = [],
  header,
  icon,
  create = false,
  endpoint,
}) => {
  const intl = useIntl();

  const [imageIndex, setImageIndex] = useState(0);
  const [imageState, setImageState] = useState<
    "loading" | "error" | "loaded" | "empty"
  >("empty");
  const [loadDict, setLoadDict] = useState<Record<number, boolean>>({});
  const [excluded, setExcluded] = useState<Record<string, boolean>>(
    excludedPerformerFields.reduce(
      (dict, field) => ({ ...dict, [field]: true }),
      {}
    )
  );

  const images = performer.images ?? [];

  const changeImage = (index: number) => {
    setImageIndex(index);
    if (!loadDict[index]) setImageState("loading");
  };
  const setPrev = () =>
    changeImage(imageIndex === 0 ? images.length - 1 : imageIndex - 1);
  const setNext = () =>
    changeImage(imageIndex === images.length - 1 ? 0 : imageIndex + 1);

  const handleLoad = (index: number) => {
    setLoadDict({
      ...loadDict,
      [index]: true,
    });
    setImageState("loaded");
  };
  const handleError = () => setImageState("error");

  const toggleField = (name: string) =>
    setExcluded({
      ...excluded,
      [name]: !excluded[name],
    });

  function maybeRenderField(
    name: string,
    text: string | null | undefined,
    truncate: boolean = true
  ) {
    if (!text) return;

    return (
      <Grid container spacing={0} sx={{ mb: 1 }}>
        <Grid size={5} sx={{ mb: "5px" }} key={name}>
          {!create && (
            <Button
              onClick={() => toggleField(name)}
              variant="outlined"
              color={excluded[name] ? "inherit" : "success"}
              sx={{ mr: 1, minWidth: 0, p: 0.5 }}
            >
              <Icon icon={excluded[name] ? faTimes : faCheck} />
            </Button>
          )}
          <Typography component="strong" variant="subtitle2">
            <FormattedMessage id={name} />:
          </Typography>
        </Grid>
        {truncate ? (
          <Grid size={7}>
            <TruncatedText text={text} />
          </Grid>
        ) : (
          <Grid size={7} component="span">
            {text}
          </Grid>
        )}
      </Grid>
    );
  }

  function maybeRenderURLListField(
    name: string,
    text: string[] | null | undefined,
    truncate: boolean = true
  ) {
    if (!text) return;

    return (
      <Grid container spacing={0} sx={{ mb: 1 }}>
        <Grid size={5} sx={{ mb: "5px" }} key={name}>
          {!create && (
            <Button
              onClick={() => toggleField(name)}
              variant="outlined"
              color={excluded[name] ? "inherit" : "success"}
              sx={{ mr: 1, minWidth: 0, p: 0.5 }}
            >
              <Icon icon={excluded[name] ? faTimes : faCheck} />
            </Button>
          )}
          <Typography component="strong" variant="subtitle2">
            <FormattedMessage id={name} />:
          </Typography>
        </Grid>
        <Grid size={7}>
          <Box component="ul" sx={{ fontSize: "0.8em", listStyleType: "none", pl: 0 }}>
            {text.map((t, i) => (
              <li key={i}>
                <ExternalLink href={t}>
                  {truncate ? <TruncatedText text={t} /> : t}
                </ExternalLink>
              </li>
            ))}
          </Box>
        </Grid>
      </Grid>
    );
  }

  function maybeRenderImage() {
    if (!images.length) return;

    return (
      <Grid size={5} sx={{ height: 450, textAlign: "center" }}>
        <Box sx={{ height: "85%", position: "relative" }}>
          {!create && (
            <Button
              onClick={() => toggleField("image")}
              variant="outlined"
              color={excluded.image ? "inherit" : "success"}
              sx={{ minWidth: 0, p: 0.5, position: "absolute", right: 20, top: 10, zIndex: 1 }}
            >
              <Icon icon={excluded.image ? faTimes : faCheck} />
            </Button>
          )}
          <Box
            component="img"
            src={images[imageIndex]}
            style={{ display: imageState !== "loaded" ? "none" : "block" }}
            sx={{ width: "100%", maxHeight: "100%", maxWidth: "100%" }}
            alt=""
            onLoad={() => handleLoad(imageIndex)}
            onError={handleError}
          />
          {imageState === "loading" && (
            <LoadingIndicator message="Loading image..." />
          )}
          {imageState === "error" && (
            <Box sx={{ display: "flex", alignItems: "center", height: "100%", justifyContent: "center" }}>
              <b>Error loading image.</b>
            </Box>
          )}
        </Box>
        <Box display="flex" mt={3} alignItems="center">
          <Button onClick={setPrev} disabled={images.length === 1} variant="outlined">
            <Icon icon={faArrowLeft} />
          </Button>
          <Typography variant="h5" sx={{ flexGrow: 1, textAlign: "center" }}>
            Select performer image
            <br />
            {imageIndex + 1} of {images.length}
          </Typography>
          <Button onClick={setNext} disabled={images.length === 1} variant="outlined">
            <Icon icon={faArrowRight} />
          </Button>
        </Box>
      </Grid>
    );
  }

  function maybeRenderStashBoxLink() {
    const base = endpoint?.match(/https?:\/\/.*?\//)?.[0];
    if (!base) return;

    return (
      <Typography variant="h6" sx={{ mt: 2 }}>
        <ExternalLink href={`${base}performers/${performer.remote_site_id}`}>
          <FormattedMessage id="stashbox.source" />
          <Icon icon={faExternalLinkAlt} />
        </ExternalLink>
      </Typography>
    );
  }

  function onSaveClicked() {
    if (!performer.name) {
      throw new Error("performer name must set");
    }

    const performerData: GQL.PerformerCreateInput & {
      [index: string]: unknown;
    } = {
      name: performer.name ?? "",
      disambiguation: performer.disambiguation ?? "",
      alias_list:
        performer.aliases?.split(",").map((a) => a.trim()) ?? undefined,
      gender: stringToGender(performer.gender ?? undefined, true),
      birthdate: performer.birthdate,
      ethnicity: performer.ethnicity,
      eye_color: performer.eye_color,
      country: performer.country,
      height_cm: Number.parseFloat(performer.height ?? "") ?? undefined,
      measurements: performer.measurements,
      fake_tits: performer.fake_tits,
      career_length: performer.career_length,
      tattoos: performer.tattoos,
      piercings: performer.piercings,
      urls: performer.urls,
      image: images.length > imageIndex ? images[imageIndex] : undefined,
      details: performer.details,
      death_date: performer.death_date,
      hair_color: performer.hair_color,
      weight: Number.parseFloat(performer.weight ?? "") ?? undefined,
    };

    if (Number.isNaN(performerData.weight ?? 0)) {
      performerData.weight = undefined;
    }

    if (Number.isNaN(performerData.height ?? 0)) {
      performerData.height = undefined;
    }

    if (performer.tags) {
      performerData.tag_ids = performer.tags
        .map((t) => t.stored_id)
        .filter((t) => t) as string[];
    }

    // stashid handling code
    const remoteSiteID = performer.remote_site_id;
    if (remoteSiteID && endpoint) {
      performerData.stash_ids = [
        {
          endpoint,
          stash_id: remoteSiteID,
          updated_at: new Date().toISOString(),
        },
      ];
    }

    // handle exclusions
    Object.keys(performerData).forEach((k) => {
      if (excluded[k] || !performerData[k]) {
        performerData[k] = undefined;
      }
      // #5565 - special case aliases as the names differ
      if (k == "alias_list" && excluded.aliases) {
        performerData.alias_list = undefined;
      }
    });

    onSave(performerData);
  }

  return (
    <ModalComponent
      show={modalVisible}
      accept={{
        text: intl.formatMessage({ id: "actions.save" }),
        onClick: onSaveClicked,
      }}
      cancel={{ onClick: () => closeModal(), variant: "secondary" }}
      onHide={() => closeModal()}
      icon={icon}
      header={header}
      sx={{
        "& .MuiDialog-paper": {
          maxWidth: 800,
          fontSize: "1.2rem",
        },
      }}
    >
      <Grid container spacing={2}>
        <Grid size={7}>
          {maybeRenderField("name", performer.name)}
          {maybeRenderField("disambiguation", performer.disambiguation)}
          {maybeRenderField("aliases", performer.aliases)}
          {maybeRenderField(
            "gender",
            performer.gender
              ? intl.formatMessage({ id: "gender_types." + performer.gender })
              : ""
          )}
          {maybeRenderField("birthdate", performer.birthdate)}
          {maybeRenderField("death_date", performer.death_date)}
          {maybeRenderField("ethnicity", performer.ethnicity)}
          {maybeRenderField("country", getCountryByISO(performer.country))}
          {maybeRenderField("hair_color", performer.hair_color)}
          {maybeRenderField("eye_color", performer.eye_color)}
          {maybeRenderField("height", performer.height)}
          {maybeRenderField("weight", performer.weight)}
          {maybeRenderField("measurements", performer.measurements)}
          {performer?.gender !== GQL.GenderEnum.Male &&
            maybeRenderField("fake_tits", performer.fake_tits)}
          {maybeRenderField("career_length", performer.career_length)}
          {maybeRenderField("tattoos", performer.tattoos, false)}
          {maybeRenderField("piercings", performer.piercings, false)}
          {maybeRenderField("weight", performer.weight, false)}
          {maybeRenderField("details", performer.details)}
          {maybeRenderURLListField("urls", performer.urls)}
          {maybeRenderStashBoxLink()}
        </Grid>
        {maybeRenderImage()}
      </Grid>
    </ModalComponent>
  );
};

export default PerformerModal;
