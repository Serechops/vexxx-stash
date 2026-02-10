import React, { useEffect, useRef, useState } from "react";
import { TextField, Grid, Chip, Box, Typography } from "@mui/material";
import { FormattedMessage, useIntl } from "react-intl";

import * as GQL from "src/core/generated-graphql";
import { ModalComponent } from "src/components/Shared/Modal";
import { LoadingIndicator } from "src/components/Shared/LoadingIndicator";
import { stashboxDisplayName } from "src/utils/stashbox";
import { useDebounce } from "src/hooks/debounce";

import { TruncatedText } from "src/components/Shared/TruncatedText";
import { stringToGender } from "src/utils/gender";
import TextUtils from "src/utils/text";
import GenderIcon from "src/components/Performers/GenderIcon";
import { CountryFlag } from "src/components/Shared/CountryFlag";

const CLASSNAME = "PerformerScrapeModal";
const CLASSNAME_LIST = `${CLASSNAME}-list`;
const CLASSNAME_LIST_CONTAINER = `${CLASSNAME_LIST}-container`;

interface IPerformerSearchResultDetailsProps {
  performer: GQL.ScrapedPerformerDataFragment;
}

const PerformerSearchResultDetails: React.FC<
  IPerformerSearchResultDetailsProps
> = ({ performer }) => {
  function renderImage() {
    if (performer.images && performer.images.length > 0) {
      return (
        <div className="scene-image-container">
          <img
            src={performer.images[0]}
            alt=""
            className="self-center scene-image"
          />
        </div>
      );
    }
  }

  function calculateAge() {
    if (performer?.birthdate) {
      return TextUtils.age(performer.birthdate, performer.death_date);
    }
  }

  function renderTags() {
    if (performer.tags) {
      return (
        <Grid container>
          <Grid size={12}>
            {performer.tags?.map((tag) => (
              <Chip
                className="tag-item"
                size="small"
                key={tag.stored_id}
                label={tag.name}
                sx={{ mr: 0.5, mb: 0.5 }}
              />
            ))}
          </Grid>
        </Grid>
      );
    }
  }

  function renderCountry() {
    if (performer.country) {
      return (
        <span>
          <CountryFlag
            className="performer-result__country-flag"
            country={performer.country}
          />
        </span>
      );
    }
  }

  let age = calculateAge();

  return (
    <div className="performer-result">
      <Grid container spacing={2}>
        <Grid size="auto">
          {renderImage()}
        </Grid>
        <Grid size="grow">
          <Box display="flex" flexDirection="column">
            <h4 className="performer-name">
              <span>{performer.name}</span>
              {performer.disambiguation && (
                <span className="performer-disambiguation">
                  {` (${performer.disambiguation})`}
                </span>
              )}
            </h4>
            <h5 className="performer-details">
              {performer.gender && (
                <span>
                  <GenderIcon
                    className="gender-icon"
                    gender={stringToGender(performer.gender, true)}
                  />
                </span>
              )}
              {age && (
                <span>
                  {`${age} `}
                  <FormattedMessage id="years_old" />
                </span>
              )}
            </h5>
            {renderCountry()}
          </Box>
        </Grid>
      </Grid>
      <Grid container>
        <Grid size={12}>
          <TruncatedText text={performer.details ?? ""} lineCount={3} />
        </Grid>
      </Grid>
      {renderTags()}
    </div>
  );
};

export interface IPerformerSearchResult {
  performer: GQL.ScrapedPerformerDataFragment;
}

export const PerformerSearchResult: React.FC<IPerformerSearchResult> = ({
  performer,
}) => {
  return (
    <div className="mt-3 search-item">
      <PerformerSearchResultDetails performer={performer} />
    </div>
  );
};

export interface IStashBox extends GQL.StashBox {
  index: number;
}

interface IProps {
  instance: IStashBox;
  onHide: () => void;
  onSelectPerformer: (performer: GQL.ScrapedPerformer) => void;
  name?: string;
}
const PerformerStashBoxModal: React.FC<IProps> = ({
  instance,
  name,
  onHide,
  onSelectPerformer,
}) => {
  const intl = useIntl();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState<string>(name ?? "");
  const { data, loading } = GQL.useScrapeSinglePerformerQuery({
    variables: {
      source: {
        stash_box_endpoint: instance.endpoint,
      },
      input: {
        query,
      },
    },
    skip: query === "",
  });

  const performers = data?.scrapeSinglePerformer ?? [];

  const onInputChange = useDebounce(setQuery, 500);

  useEffect(() => inputRef.current?.focus(), []);

  function renderResults() {
    if (!performers) {
      return;
    }

    return (
      <div className={CLASSNAME_LIST_CONTAINER}>
        <div className="mt-1">
          <FormattedMessage
            id="dialogs.performers_found"
            values={{ count: performers.length }}
          />
        </div>
        <ul className={CLASSNAME_LIST}>
          {performers.map((p, i) => (
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions, react/no-array-index-key
            <li key={i} onClick={() => onSelectPerformer(p)}>
              <PerformerSearchResult performer={p} />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <ModalComponent
      show
      onHide={onHide}
      header={`Scrape performer from ${stashboxDisplayName(
        instance.name,
        instance.index
      )}`}
      accept={{
        text: intl.formatMessage({ id: "actions.cancel" }),
        onClick: onHide,
        variant: "secondary",
      }}
    >
      <div className={CLASSNAME}>
        <TextField
          onChange={(e) => onInputChange(e.target.value)}
          defaultValue={name ?? ""}
          placeholder="Performer name..."
          className="text-input mb-4"
          inputRef={inputRef}
          fullWidth
        />
        {loading ? (
          <div className="m-4 text-center">
            <LoadingIndicator inline />
          </div>
        ) : performers.length > 0 ? (
          renderResults()
        ) : (
          query !== "" && <h5 className="text-center">No results found.</h5>
        )}
      </div>
    </ModalComponent>
  );
};

export default PerformerStashBoxModal;
