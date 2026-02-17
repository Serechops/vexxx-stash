import React from "react";
import isEqual from "lodash-es/isEqual";
import clone from "lodash-es/clone";
import {
  Checkbox,
  TextField,
  MenuItem,
  Stack,
  Box,
  TableCell,
} from "@mui/material";
import {
  ParseSceneFilenamesQuery,
  SlimSceneDataFragment,
} from "src/core/generated-graphql";
import {
  PerformerSelect,
  TagSelect,
  StudioSelect,
} from "src/components/Shared/Select";
import { objectTitle } from "src/core/files";

class ParserResult<T> {
  public value?: T;
  public originalValue?: T;
  public isSet: boolean = false;

  public setOriginalValue(value?: T) {
    this.originalValue = value;
    this.value = value;
  }

  public setValue(value?: T) {
    if (value) {
      this.value = value;
      this.isSet = !isEqual(this.value, this.originalValue);
    }
  }
}

export class SceneParserResult {
  public id: string;
  public filename: string;
  public title: ParserResult<string> = new ParserResult<string>();
  public date: ParserResult<string> = new ParserResult<string>();
  public rating: ParserResult<number> = new ParserResult<number>();

  public studio: ParserResult<string> = new ParserResult<string>();
  public tags: ParserResult<string[]> = new ParserResult<string[]>();
  public performers: ParserResult<string[]> = new ParserResult<string[]>();

  public scene: SlimSceneDataFragment;

  constructor(
    result: ParseSceneFilenamesQuery["parseSceneFilenames"]["results"][0]
  ) {
    this.scene = result.scene;

    this.id = this.scene.id;
    this.filename = objectTitle(this.scene);
    this.title.setOriginalValue(this.scene.title ?? undefined);
    this.date.setOriginalValue(this.scene.date ?? undefined);
    this.rating.setOriginalValue(this.scene.rating100 ?? undefined);
    this.performers.setOriginalValue(this.scene.performers.map((p) => p.id));
    this.tags.setOriginalValue(this.scene.tags.map((t) => t.id));
    this.studio.setOriginalValue(this.scene.studio?.id);

    this.title.setValue(result.title ?? undefined);
    this.date.setValue(result.date ?? undefined);
    this.rating.setValue(result.rating ?? undefined);

    this.performers.setValue(result.performer_ids ?? undefined);
    this.tags.setValue(result.tag_ids ?? undefined);
    this.studio.setValue(result.studio_id ?? undefined);
  }

  // returns true if any of its fields have set == true
  public isChanged() {
    return (
      this.title.isSet ||
      this.date.isSet ||
      this.rating.isSet ||
      this.performers.isSet ||
      this.studio.isSet ||
      this.tags.isSet
    );
  }

  public toSceneUpdateInput() {
    return {
      id: this.id,
      rating: this.rating.isSet ? this.rating.value : undefined,
      title: this.title.isSet ? this.title.value : undefined,
      date: this.date.isSet ? this.date.value : undefined,
      studio_id: this.studio.isSet ? this.studio.value : undefined,
      performer_ids: this.performers.isSet ? this.performers.value : undefined,
      tag_ids: this.tags.isSet ? this.tags.value : undefined,
    };
  }
}

interface ISceneParserFieldProps<T> {
  parserResult: ParserResult<T>;
  width?: string;
  onSetChanged: (isSet: boolean) => void;
  onValueChanged: (value: T) => void;
  originalParserResult?: ParserResult<T>;
}

function SceneParserStringField(props: ISceneParserFieldProps<string>) {
  function maybeValueChanged(value: string) {
    if (value !== props.parserResult.value) {
      props.onValueChanged(value);
    }
  }

  const result = props.originalParserResult || props.parserResult;

  return (
    <>
      <TableCell padding="checkbox">
        <Checkbox
          checked={props.parserResult.isSet}
          onChange={() => {
            props.onSetChanged(!props.parserResult.isSet);
          }}
          size="small"
        />
      </TableCell>
      <TableCell sx={{ verticalAlign: 'top', width: props.width }}>
        <Stack spacing={1}>
          <TextField
            fullWidth
            disabled
            variant="outlined"
            size="small"
            value={result.originalValue || ""}
            slotProps={{
              htmlInput: { readOnly: true }
            }}
          />
          <TextField
            fullWidth
            variant="outlined"
            size="small"
            disabled={!props.parserResult.isSet}
            value={props.parserResult.value || ""}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              maybeValueChanged(event.currentTarget.value)
            }
          />
        </Stack>
      </TableCell>
    </>
  );
}

function SceneParserRatingField(
  props: ISceneParserFieldProps<number | undefined>
) {
  function maybeValueChanged(value?: number) {
    if (value !== props.parserResult.value) {
      props.onValueChanged(value);
    }
  }

  const result = props.originalParserResult || props.parserResult;
  const options = ["", 1, 2, 3, 4, 5];

  return (
    <>
      <TableCell padding="checkbox">
        <Checkbox
          checked={props.parserResult.isSet}
          onChange={() => {
            props.onSetChanged(!props.parserResult.isSet);
          }}
          size="small"
        />
      </TableCell>
      <TableCell sx={{ verticalAlign: 'top', width: props.width }}>
        <Stack spacing={1}>
          <TextField
            fullWidth
            disabled
            variant="outlined"
            size="small"
            value={result.originalValue || ""}
            slotProps={{
              htmlInput: { readOnly: true }
            }}
          />
          <TextField
            select
            fullWidth
            variant="outlined"
            size="small"
            disabled={!props.parserResult.isSet}
            value={props.parserResult.value?.toString() || ""}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              maybeValueChanged(
                event.target.value === ""
                  ? undefined
                  : Number.parseInt(event.target.value, 10)
              )
            }
          >
            {options.map((opt) => (
              <MenuItem value={opt} key={opt}>
                {opt}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </TableCell>
    </>
  );
}

function SceneParserPerformerField(props: ISceneParserFieldProps<string[]>) {
  function maybeValueChanged(value: string[]) {
    if (value !== props.parserResult.value) {
      props.onValueChanged(value);
    }
  }

  const originalPerformers = (props.originalParserResult?.originalValue ??
    []) as string[];
  const newPerformers = props.parserResult.value ?? [];

  return (
    <>
      <TableCell padding="checkbox">
        <Checkbox
          checked={props.parserResult.isSet}
          onChange={() => {
            props.onSetChanged(!props.parserResult.isSet);
          }}
          size="small"
        />
      </TableCell>
      <TableCell sx={{ verticalAlign: 'top', minWidth: 200, width: props.width }}>
        <Stack spacing={1}>
          <PerformerSelect
            isDisabled
            isMulti
            ids={originalPerformers}
          />
          <PerformerSelect
            isMulti
            isDisabled={!props.parserResult.isSet}
            onSelect={(items) => {
              maybeValueChanged(items.map((i) => i.id));
            }}
            ids={newPerformers}
          />
        </Stack>
      </TableCell>
    </>
  );
}

function SceneParserTagField(props: ISceneParserFieldProps<string[]>) {
  function maybeValueChanged(value: string[]) {
    if (value !== props.parserResult.value) {
      props.onValueChanged(value);
    }
  }

  const originalTags = props.originalParserResult?.originalValue ?? [];
  const newTags = props.parserResult.value ?? [];

  return (
    <>
      <TableCell padding="checkbox">
        <Checkbox
          checked={props.parserResult.isSet}
          onChange={() => {
            props.onSetChanged(!props.parserResult.isSet);
          }}
          size="small"
        />
      </TableCell>
      <TableCell sx={{ verticalAlign: 'top', minWidth: 200, width: props.width }}>
        <Stack spacing={1}>
          <TagSelect
            isDisabled
            isMulti
            ids={originalTags}
          />
          <TagSelect
            isMulti
            isDisabled={!props.parserResult.isSet}
            onSelect={(items) => {
              maybeValueChanged(items.map((i) => i.id));
            }}
            ids={newTags}
          />
        </Stack>
      </TableCell>
    </>
  );
}

function SceneParserStudioField(props: ISceneParserFieldProps<string>) {
  function maybeValueChanged(value: string) {
    if (value !== props.parserResult.value) {
      props.onValueChanged(value);
    }
  }

  const originalStudio = props.originalParserResult?.originalValue
    ? [props.originalParserResult?.originalValue]
    : [];
  const newStudio = props.parserResult.value ? [props.parserResult.value] : [];

  return (
    <>
      <TableCell padding="checkbox">
        <Checkbox
          checked={props.parserResult.isSet}
          onChange={() => {
            props.onSetChanged(!props.parserResult.isSet);
          }}
          size="small"
        />
      </TableCell>
      <TableCell sx={{ verticalAlign: 'top', minWidth: 200, width: props.width }}>
        <Stack spacing={1}>
          <StudioSelect
            isDisabled
            ids={originalStudio}
          />
          <StudioSelect
            isDisabled={!props.parserResult.isSet}
            onSelect={(items) => {
              maybeValueChanged(items[0].id);
            }}
            ids={newStudio}
          />
        </Stack>
      </TableCell>
    </>
  );
}

interface ISceneParserRowProps {
  scene: SceneParserResult;
  onChange: (changedScene: SceneParserResult) => void;
  showFields: Map<string, boolean>;
}

export const SceneParserRow = (props: ISceneParserRowProps) => {
  function changeParser<T>(result: ParserResult<T>, isSet: boolean, value?: T) {
    const newParser = clone(result);
    newParser.isSet = isSet;
    newParser.value = value;
    return newParser;
  }

  function onTitleChanged(set: boolean, value: string) {
    const newResult = clone(props.scene);
    newResult.title = changeParser(newResult.title, set, value);
    props.onChange(newResult);
  }

  function onDateChanged(set: boolean, value: string) {
    const newResult = clone(props.scene);
    newResult.date = changeParser(newResult.date, set, value);
    props.onChange(newResult);
  }

  function onRatingChanged(set: boolean, value?: number) {
    const newResult = clone(props.scene);
    newResult.rating = changeParser(newResult.rating, set, value);
    props.onChange(newResult);
  }

  function onPerformerIdsChanged(set: boolean, value: string[]) {
    const newResult = clone(props.scene);
    newResult.performers = changeParser(newResult.performers, set, value);
    props.onChange(newResult);
  }

  function onTagIdsChanged(set: boolean, value: string[]) {
    const newResult = clone(props.scene);
    newResult.tags = changeParser(newResult.tags, set, value);
    props.onChange(newResult);
  }

  function onStudioIdChanged(set: boolean, value: string) {
    const newResult = clone(props.scene);
    newResult.studio = changeParser(newResult.studio, set, value);
    props.onChange(newResult);
  }

  return (
    <tr>
      <TableCell sx={{ verticalAlign: 'top', textAlign: 'left', width: '30ch', position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 1 }}>
        {props.scene.filename}
      </TableCell>
      {props.showFields.get("Title") && (
        <SceneParserStringField
          key="title"
          width="40ch"
          parserResult={props.scene.title}
          onSetChanged={(isSet) =>
            onTitleChanged(isSet, props.scene.title.value ?? "")
          }
          onValueChanged={(value) =>
            onTitleChanged(props.scene.title.isSet, value)
          }
        />
      )}
      {props.showFields.get("Date") && (
        <SceneParserStringField
          key="date"
          width="13ch"
          parserResult={props.scene.date}
          onSetChanged={(isSet) =>
            onDateChanged(isSet, props.scene.date.value ?? "")
          }
          onValueChanged={(value) =>
            onDateChanged(props.scene.date.isSet, value)
          }
        />
      )}
      {props.showFields.get("Rating") && (
        <SceneParserRatingField
          key="rating"
          parserResult={props.scene.rating}
          onSetChanged={(isSet) =>
            onRatingChanged(isSet, props.scene.rating.value ?? undefined)
          }
          onValueChanged={(value) =>
            onRatingChanged(props.scene.rating.isSet, value)
          }
        />
      )}
      {props.showFields.get("Performers") && (
        <SceneParserPerformerField
          key="performers"
          width="30ch"
          parserResult={props.scene.performers}
          originalParserResult={props.scene.performers}
          onSetChanged={(set) =>
            onPerformerIdsChanged(set, props.scene.performers.value ?? [])
          }
          onValueChanged={(value) =>
            onPerformerIdsChanged(props.scene.performers.isSet, value)
          }
        />
      )}
      {props.showFields.get("Tags") && (
        <SceneParserTagField
          key="tags"
          width="30ch"
          parserResult={props.scene.tags}
          originalParserResult={props.scene.tags}
          onSetChanged={(isSet) =>
            onTagIdsChanged(isSet, props.scene.tags.value ?? [])
          }
          onValueChanged={(value) =>
            onTagIdsChanged(props.scene.tags.isSet, value)
          }
        />
      )}
      {props.showFields.get("Studio") && (
        <SceneParserStudioField
          key="studio"
          width="20ch"
          parserResult={props.scene.studio}
          originalParserResult={props.scene.studio}
          onSetChanged={(set) =>
            onStudioIdChanged(set, props.scene.studio.value ?? "")
          }
          onValueChanged={(value) =>
            onStudioIdChanged(props.scene.studio.isSet, value)
          }
        />
      )}
    </tr>
  );
};
