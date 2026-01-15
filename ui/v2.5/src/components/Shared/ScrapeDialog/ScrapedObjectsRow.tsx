import React, { useMemo } from "react";
import * as GQL from "src/core/generated-graphql";
import { ScrapeDialogRow } from "src/components/Shared/ScrapeDialog/ScrapeDialogRow";
import { PerformerSelect } from "src/components/Performers/PerformerSelect";
import {
  ObjectScrapeResult,
  ScrapeResult,
} from "src/components/Shared/ScrapeDialog/scrapeResult";
import { TagIDSelect } from "src/components/Tags/TagSelect";
import { StudioSelect } from "src/components/Studios/StudioSelect";
import { GroupSelect } from "src/components/Groups/GroupSelect";
import { uniq } from "lodash-es";
import { CollapseButton } from "../CollapseButton";
import { Chip } from "@mui/material";
import { Icon } from "../Icon";
import { faLink, faPlus } from "@fortawesome/free-solid-svg-icons";
import { useIntl } from "react-intl";

interface INewScrapedObjects<T> {
  newValues: T[];
  onCreateNew: (value: T) => void;
  onLinkExisting?: (value: T) => void;
  getName: (value: T) => string;
}

export const NewScrapedObjects = <T,>(props: INewScrapedObjects<T>) => {
  const intl = useIntl();

  if (props.newValues.length === 0) {
    return null;
  }

  const ret = (
    <>
      {props.newValues.map((t) => (
        <Chip
          className="tag-item ml-1 mb-1"
          key={props.getName(t)}
          label={props.getName(t)}
          onClick={() => props.onCreateNew(t)}
          onDelete={() => props.onCreateNew(t)}
          deleteIcon={<Icon icon={faPlus} />}
          variant="outlined"
          size="small"
        />
        // Note: onLinkExisting logic is harder to replicate directly in Chip deleteIcon
        // If we need two actions (Create and Link), Chip supports only one 'onDelete'.
        // We might need to make label a complex object or use a custom component.
        // However, looking at original code:
        /*
          <Badge ... onClick={onCreateNew}>
             {name}
             <Button ... icon={faPlus} />
             {onLinkExisting ? <Button ... icon={faLink} ... /> : null}
          </Badge>
        */
        // It had TWO buttons if onLinkExisting is present.
        // Chip only has one action + one delete action.
        // If onLinkExisting is present, we need to show both.
        // I will use a custom component using Chip behavior or just a Box with IconButtons.
      ))}
    </>
  );

  // Redefining loop to handle multiple actions if needed
  // If onLinkExisting is provided, we might need a custom render.
  if (props.onLinkExisting) {
    return (
      <>
        {props.newValues.map((t) => (
          <Chip
            className="tag-item ml-1 mb-1"
            key={props.getName(t)}
            label={
              <span style={{ display: 'flex', alignItems: 'center' }}>
                {props.getName(t)}
                {props.onLinkExisting && (
                  <Icon
                    icon={faLink}
                    className="ml-2 hover-icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onLinkExisting?.(t);
                    }}
                  />
                )}
              </span>
            }
            onClick={() => props.onCreateNew(t)}
            onDelete={() => props.onCreateNew(t)}
            deleteIcon={<Icon icon={faPlus} />}
            variant="outlined"
            size="small"
          />
        ))}
      </>
    )
  }

  // .. rest of logic ..
  const minCollapseLength = 10;

  if (props.newValues!.length >= minCollapseLength) {
    const missingText = intl.formatMessage({
      id: "dialogs.scrape_results_missing",
    });
    return (
      <CollapseButton text={`${missingText} (${props.newValues!.length})`}>
        {ret}
      </CollapseButton>
    );
  }

  return ret;
};

interface IScrapedStudioRow {
  title: string;
  field: string;
  result: ObjectScrapeResult<GQL.ScrapedStudio>;
  onChange: (value: ObjectScrapeResult<GQL.ScrapedStudio>) => void;
  newStudio?: GQL.ScrapedStudio;
  onCreateNew?: (value: GQL.ScrapedStudio) => void;
  onLinkExisting?: (value: GQL.ScrapedStudio) => void;
}

function getObjectName<T extends { name: string }>(value: T) {
  return value.name;
}

export const ScrapedStudioRow: React.FC<IScrapedStudioRow> = ({
  title,
  field,
  result,
  onChange,
  newStudio,
  onCreateNew,
  onLinkExisting,
}) => {
  function renderScrapedStudio(
    scrapeResult: ObjectScrapeResult<GQL.ScrapedStudio>,
    isNew?: boolean,
    onChangeFn?: (value: GQL.ScrapedStudio) => void
  ) {
    const resultValue = isNew
      ? scrapeResult.newValue
      : scrapeResult.originalValue;
    const value = resultValue ? [resultValue] : [];

    const selectValue = value.map((p) => {
      const aliases: string[] = p.aliases
        ? p.aliases.split(",").map((a) => a.trim())
        : [];
      return {
        id: p.stored_id ?? "",
        name: p.name ?? "",
        aliases,
      };
    });

    return (
      <StudioSelect
        className="react-select"
        isDisabled={!isNew}
        onSelect={(items) => {
          if (onChangeFn) {
            const { id, aliases, ...data } = items[0];
            onChangeFn({
              ...data,
              stored_id: id,
              aliases: aliases?.join(", "),
            });
          }
        }}
        values={selectValue}
      />
    );
  }

  return (
    <ScrapeDialogRow
      title={title}
      field={field}
      result={result}
      originalField={renderScrapedStudio(result)}
      newField={renderScrapedStudio(result, true, (value) =>
        onChange(result.cloneWithValue(value))
      )}
      onChange={onChange}
      newValues={
        newStudio && onCreateNew ? (
          <NewScrapedObjects
            newValues={[newStudio]}
            onCreateNew={onCreateNew}
            getName={getObjectName}
            onLinkExisting={onLinkExisting}
          />
        ) : undefined
      }
    />
  );
};

interface IScrapedObjectsRow<T> {
  title: string;
  field: string;
  result: ScrapeResult<T[]>;
  onChange: (value: ScrapeResult<T[]>) => void;
  newObjects?: T[];
  onCreateNew?: (value: T) => void;
  onLinkExisting?: (value: T) => void;
  renderObjects: (
    result: ScrapeResult<T[]>,
    isNew?: boolean,
    onChange?: (value: T[]) => void
  ) => JSX.Element;
  getName: (value: T) => string;
}

export const ScrapedObjectsRow = <T,>(props: IScrapedObjectsRow<T>) => {
  const {
    title,
    field,
    result,
    onChange,
    newObjects = [],
    onCreateNew,
    onLinkExisting,
    renderObjects,
    getName,
  } = props;

  return (
    <ScrapeDialogRow
      title={title}
      field={field}
      result={result}
      originalField={renderObjects(result)}
      newField={renderObjects(result, true, (value) =>
        onChange(result.cloneWithValue(value))
      )}
      onChange={onChange}
      newValues={
        onCreateNew && newObjects.length > 0 ? (
          <NewScrapedObjects
            newValues={newObjects ?? []}
            onCreateNew={onCreateNew}
            onLinkExisting={onLinkExisting}
            getName={getName}
          />
        ) : undefined
      }
    />
  );
};

type IScrapedObjectRowImpl<T> = Omit<
  IScrapedObjectsRow<T>,
  "renderObjects" | "getName"
>;

export const ScrapedPerformersRow: React.FC<
  IScrapedObjectRowImpl<GQL.ScrapedPerformer> & { ageFromDate?: string | null }
> = ({
  title,
  field,
  result,
  onChange,
  newObjects,
  onCreateNew,
  ageFromDate,
  onLinkExisting,
}) => {
    const performersCopy = useMemo(() => {
      return (
        newObjects?.map((p) => {
          const name: string = p.name ?? "";
          return { ...p, name };
        }) ?? []
      );
    }, [newObjects]);

    function renderScrapedPerformers(
      scrapeResult: ScrapeResult<GQL.ScrapedPerformer[]>,
      isNew?: boolean,
      onChangeFn?: (value: GQL.ScrapedPerformer[]) => void
    ) {
      const resultValue = isNew
        ? scrapeResult.newValue
        : scrapeResult.originalValue;
      const value = resultValue ?? [];

      const selectValue = value.map((p) => {
        const alias_list: string[] = [];
        return {
          id: p.stored_id ?? "",
          name: p.name ?? "",
          alias_list,
        };
      });

      return (
        <PerformerSelect
          isMulti
          className=""
          isDisabled={!isNew}
          onSelect={(items) => {
            if (onChangeFn) {
              // map the id back to stored_id
              onChangeFn(items.map((p) => ({ ...p, stored_id: p.id })));
            }
          }}
          values={selectValue}
          ageFromDate={ageFromDate}
        />
      );
    }

    return (
      <ScrapedObjectsRow<GQL.ScrapedPerformer>
        title={title}
        field={field}
        result={result}
        renderObjects={renderScrapedPerformers}
        onChange={onChange}
        newObjects={performersCopy}
        onCreateNew={onCreateNew}
        getName={(value) => value.name ?? ""}
        onLinkExisting={onLinkExisting}
      />
    );
  };

export const ScrapedGroupsRow: React.FC<
  IScrapedObjectRowImpl<GQL.ScrapedGroup>
> = ({
  title,
  field,
  result,
  onChange,
  newObjects,
  onCreateNew,
  onLinkExisting,
}) => {
    const groupsCopy = useMemo(() => {
      return (
        newObjects?.map((p) => {
          const name: string = p.name ?? "";
          return { ...p, name };
        }) ?? []
      );
    }, [newObjects]);

    function renderScrapedGroups(
      scrapeResult: ScrapeResult<GQL.ScrapedGroup[]>,
      isNew?: boolean,
      onChangeFn?: (value: GQL.ScrapedGroup[]) => void
    ) {
      const resultValue = isNew
        ? scrapeResult.newValue
        : scrapeResult.originalValue;
      const value = resultValue ?? [];

      const selectValue = value.map((p) => {
        const aliases: string = "";
        return {
          id: p.stored_id ?? "",
          name: p.name ?? "",
          aliases,
        };
      });

      return (
        <GroupSelect
          isMulti
          className="react-select"
          isDisabled={!isNew}
          onSelect={(items) => {
            if (onChangeFn) {
              // map the id back to stored_id
              onChangeFn(items.map((p) => ({ ...p, stored_id: p.id })));
            }
          }}
          values={selectValue}
        />
      );
    }

    return (
      <ScrapedObjectsRow<GQL.ScrapedGroup>
        title={title}
        field={field}
        result={result}
        renderObjects={renderScrapedGroups}
        onChange={onChange}
        newObjects={groupsCopy}
        onCreateNew={onCreateNew}
        getName={(value) => value.name ?? ""}
        onLinkExisting={onLinkExisting}
      />
    );
  };

export const ScrapedTagsRow: React.FC<
  IScrapedObjectRowImpl<GQL.ScrapedTag>
> = ({
  title,
  field,
  result,
  onChange,
  newObjects,
  onCreateNew,
  onLinkExisting,
}) => {
    function renderScrapedTags(
      scrapeResult: ScrapeResult<GQL.ScrapedTag[]>,
      isNew?: boolean,
      onChangeFn?: (value: GQL.ScrapedTag[]) => void
    ) {
      const resultValue = isNew
        ? scrapeResult.newValue
        : scrapeResult.originalValue;
      const value = resultValue ?? [];

      const selectValue = uniq(value.map((p) => p.stored_id ?? ""));

      // we need to use TagIDSelect here because we want to use the local name
      // of the tag instead of the name from the source
      return (
        <TagIDSelect
          isMulti
          className=""
          isDisabled={!isNew}
          onSelect={(items) => {
            if (onChangeFn) {
              // map the id back to stored_id
              onChangeFn(items.map((p) => ({ ...p, stored_id: p.id })));
            }
          }}
          ids={selectValue}
        />
      );
    }

    return (
      <ScrapedObjectsRow<GQL.ScrapedTag>
        title={title}
        field={field}
        result={result}
        renderObjects={renderScrapedTags}
        onChange={onChange}
        newObjects={newObjects}
        onCreateNew={onCreateNew}
        onLinkExisting={onLinkExisting}
        getName={getObjectName}
      />
    );
  };
