import React, { useMemo } from "react";
import { Button, ButtonGroup, Box } from "@mui/material";
import { FormattedMessage } from "react-intl";

import { StudioSelect, SelectObject } from "src/components/Shared/Select";
import * as GQL from "src/core/generated-graphql";

import { OptionalField } from "../IncludeButton";
import { getStashboxBase } from "src/utils/stashbox";
import { ExternalLink } from "src/components/Shared/ExternalLink";
import { Link } from "react-router-dom";
import { LinkButton } from "../LinkButton";

const StudioLink: React.FC<{
  studio: GQL.ScrapedStudio | GQL.SlimStudioDataFragment;
  url: string | undefined;
  internal?: boolean;
}> = ({ studio, url, internal = false }) => {
  const name = useMemo(() => {
    if (!url) return studio.name;

    return internal ? (
      <Link to={url} target="_blank">
        {studio.name}
      </Link>
    ) : (
      <ExternalLink href={url}>{studio.name}</ExternalLink>
    );
  }, [url, studio.name, internal]);

  return <span>{name}</span>;
};

interface IStudioResultProps {
  studio: GQL.ScrapedStudio;
  selectedID: string | undefined;
  setSelectedID: (id: string | undefined) => void;
  onCreate: () => void;
  onLink?: () => Promise<void>;
  endpoint?: string;
}

const StudioResult: React.FC<IStudioResultProps> = ({
  studio,
  selectedID,
  setSelectedID,
  onCreate,
  onLink,
  endpoint,
}) => {
  const { data: studioData, loading: stashLoading } = GQL.useFindStudioQuery({
    variables: { id: studio.stored_id ?? "" },
    skip: !studio.stored_id,
  });

  const matchedStudio = studioData?.findStudio;
  const matchedStashID = matchedStudio?.stash_ids.some(
    (stashID) => stashID.endpoint === endpoint && stashID.stash_id
  );

  const stashboxStudioPrefix = endpoint
    ? `${getStashboxBase(endpoint)}studios/`
    : undefined;
  const studioURLPrefix = "/studios/";

  const handleSelect = (studios: SelectObject[]) => {
    if (studios.length) {
      setSelectedID(studios[0].id);
    } else {
      setSelectedID(undefined);
    }
  };

  const handleSkip = () => {
    setSelectedID(undefined);
  };

  if (stashLoading) return <div>Loading studio</div>;

  if (matchedStudio && matchedStashID) {
    return (
      <Box sx={{ display: "flex", flexWrap: "wrap", my: 1 }}>
        <Box sx={{ flex: 1, mr: "auto" }}>
          <FormattedMessage id="countables.studios" values={{ count: 1 }} />:
          <Box component="b" sx={{ ml: 1 }}>
            <StudioLink
              studio={studio}
              url={`${stashboxStudioPrefix}${studio.remote_site_id}`}
            />
          </Box>
        </Box>
        <Box component="span" sx={{ ml: "auto" }}>
          <OptionalField
            exclude={selectedID === undefined}
            setExclude={(v) =>
              v ? handleSkip() : setSelectedID(matchedStudio.id)
            }
          >
            <div>
              <Box component="span" sx={{ mr: 1 }}>
                <FormattedMessage id="component_tagger.verb_matched" />:
              </Box>
              <Box component="b" sx={{ textAlign: "right", width: "25%" }}>
                <StudioLink
                  studio={matchedStudio}
                  url={`${studioURLPrefix}${matchedStudio.id}`}
                  internal
                />
              </Box>
            </div>
          </OptionalField>
        </Box>
      </Box>
    );
  }

  const selectedSource = !selectedID ? "skip" : "existing";

  const safeBuildStudioScraperLink = (id: string | null | undefined) => {
    return stashboxStudioPrefix && id
      ? `${stashboxStudioPrefix}${id}`
      : undefined;
  };

  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", mt: 1 }}>
      <Box sx={{ flex: 1, mr: "auto" }}>
        <FormattedMessage id="countables.studios" values={{ count: 1 }} />:
        <Box component="b" sx={{ ml: 1 }}>
          <StudioLink
            studio={studio}
            url={safeBuildStudioScraperLink(studio.remote_site_id)}
          />
        </Box>
      </Box>
      <ButtonGroup size="small">
        <Button variant="outlined" onClick={() => onCreate()}>
          <FormattedMessage id="actions.create" />
        </Button>
        <Button
          variant={selectedSource === "skip" ? "contained" : "outlined"}
          onClick={() => handleSkip()}
        >
          <FormattedMessage id="actions.skip" />
        </Button>
        <Box
          sx={{
            width: "18rem",
            ...(selectedSource === "existing" && {
              "& .react-select__control": { bgcolor: "#137cbd" },
            }),
          }}
        >
          <StudioSelect
            ids={selectedID ? [selectedID] : []}
            onSelect={handleSelect}
            isClearable={false}
          />
        </Box>
        {endpoint && onLink && (
          <LinkButton disabled={selectedID === undefined} onLink={onLink} />
        )}
      </ButtonGroup>
    </Box>
  );
};

export default StudioResult;
