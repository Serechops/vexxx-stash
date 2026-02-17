import React, { useEffect, useMemo, useState } from "react";
import { Button, ButtonGroup, Box, Stack } from "@mui/material";
import { FormattedMessage } from "react-intl";

import * as GQL from "src/core/generated-graphql";
import { OptionalField } from "../IncludeButton";
import {
  Performer,
  PerformerSelect,
} from "src/components/Performers/PerformerSelect";
import { getStashboxBase } from "src/utils/stashbox";
import { ExternalLink } from "src/components/Shared/ExternalLink";
import { Link } from "react-router-dom";
import { LinkButton } from "../LinkButton";

const PerformerLink: React.FC<{
  performer: GQL.ScrapedPerformer | Performer;
  url: string | undefined;
  internal?: boolean;
}> = ({ performer, url, internal = false }) => {
  const name = useMemo(() => {
    if (!url) return performer.name;

    return internal ? (
      <Link to={url} target="_blank">
        {performer.name}
      </Link>
    ) : (
      <ExternalLink href={url}>{performer.name}</ExternalLink>
    );
  }, [url, performer.name, internal]);

  return (
    <>
      <span>{name}</span>
      {performer.disambiguation && (
        <Box component="span" sx={{ letterSpacing: "-0.04rem", opacity: 0.65 }}>
          {` (${performer.disambiguation})`}
        </Box>
      )}
    </>
  );
};

interface IPerformerResultProps {
  performer: GQL.ScrapedPerformer;
  selectedID: string | undefined;
  setSelectedID: (id: string | undefined) => void;
  onCreate: () => void;
  onLink?: () => Promise<void>;
  endpoint?: string;
  ageFromDate?: string | null;
}

const PerformerResult: React.FC<IPerformerResultProps> = ({
  performer,
  selectedID,
  setSelectedID,
  onCreate,
  onLink,
  endpoint,
  ageFromDate,
}) => {
  const { data: performerData, loading: stashLoading } =
    GQL.useFindPerformerQuery({
      variables: { id: performer.stored_id ?? "" },
      skip: !performer.stored_id,
    });

  const matchedPerformer = performerData?.findPerformer;
  const matchedStashID = matchedPerformer?.stash_ids.some(
    (stashID) =>
      stashID.endpoint === endpoint &&
      stashID.stash_id === performer.remote_site_id
  );

  const [selectedPerformer, setSelectedPerformer] = useState<Performer>();

  const stashboxPerformerPrefix = endpoint
    ? `${getStashboxBase(endpoint)}performers/`
    : undefined;
  const performerURLPrefix = "/performers/";

  function selectPerformer(selected: Performer | undefined) {
    setSelectedPerformer(selected);
    setSelectedID(selected?.id);
  }

  useEffect(() => {
    if (
      performerData?.findPerformer &&
      selectedID === performerData?.findPerformer?.id
    ) {
      setSelectedPerformer(performerData.findPerformer);
    }
  }, [performerData?.findPerformer, selectedID]);

  const handleSelect = (performers: Performer[]) => {
    if (performers.length) {
      selectPerformer(performers[0]);
    } else {
      selectPerformer(undefined);
    }
  };

  const handleSkip = () => {
    selectPerformer(undefined);
  };

  if (stashLoading) return <div>Loading performer</div>;

  if (matchedPerformer && matchedStashID) {
    return (
      <Box sx={{ display: "flex", flexWrap: "wrap", my: 1 }}>
        <Box sx={{ flex: 1, mr: "auto" }}>
          <FormattedMessage id="countables.performers" values={{ count: 1 }} />:
          <Box component="b" sx={{ ml: 1 }}>
            <PerformerLink
              performer={performer}
              url={`${stashboxPerformerPrefix}${performer.remote_site_id}`}
            />
          </Box>
        </Box>
        <Box component="span" sx={{ ml: "auto" }}>
          <OptionalField
            exclude={selectedID === undefined}
            setExclude={(v) =>
              v ? handleSkip() : setSelectedID(matchedPerformer.id)
            }
          >
            <div>
              <Box component="span" sx={{ mr: 1 }}>
                <FormattedMessage id="component_tagger.verb_matched" />:
              </Box>
              <Box component="b" sx={{ textAlign: "right", width: "25%" }}>
                <PerformerLink
                  performer={matchedPerformer}
                  url={`${performerURLPrefix}${matchedPerformer.id}`}
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

  const safeBuildPerformerScraperLink = (id: string | null | undefined) => {
    return stashboxPerformerPrefix && id
      ? `${stashboxPerformerPrefix}${id}`
      : undefined;
  };

  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", mt: 1 }}>
      <Box sx={{ flex: 1, mr: "auto" }}>
        <FormattedMessage id="countables.performers" values={{ count: 1 }} />:
        <Box component="b" sx={{ ml: 1 }}>
          <PerformerLink
            performer={performer}
            url={safeBuildPerformerScraperLink(performer.remote_site_id)}
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
        <PerformerSelect
          values={selectedPerformer ? [selectedPerformer] : []}
          onSelect={handleSelect}
          active={selectedSource === "existing"}
          isClearable={false}
          ageFromDate={ageFromDate}
        />
        {endpoint && onLink && (
          <LinkButton disabled={selectedID === undefined} onLink={onLink} />
        )}
      </ButtonGroup>
    </Box>
  );
};

export default PerformerResult;
