import { faGripVertical, faMinus } from "@fortawesome/free-solid-svg-icons";
import React, { ComponentType, useState } from "react";
import { Button, TextField, Box, IconButton } from "@mui/material";
import { Icon } from "./Icon";

interface IListInputComponentProps {
  value: string;
  setValue: (value: string) => void;
  placeholder?: string;
  className?: string;
  readOnly?: boolean;
}

interface IListInputAppendProps {
  value: string;
}

export interface IStringListInputProps {
  value: string[];
  setValue: (value: string[]) => void;
  inputComponent?: ComponentType<IListInputComponentProps>;
  appendComponent?: ComponentType<IListInputAppendProps>;
  placeholder?: string;
  className?: string;
  errors?: string;
  errorIdx?: number[];
  readOnly?: boolean;
  // defaults to true if not set
  orderable?: boolean;
}

export const StringInput: React.FC<IListInputComponentProps> = ({
  className,
  placeholder,
  value,
  setValue,
  readOnly = false,
}) => {
  return (
    <TextField
      className={`text-input ${className ?? ""}`}
      value={value}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
        setValue(e.currentTarget.value)
      }
      placeholder={placeholder}
      disabled={readOnly}
      size="small"
      fullWidth
    />
  );
};

export const StringListInput: React.FC<IStringListInputProps> = (props) => {
  const Input = props.inputComponent ?? StringInput;
  const AppendComponent = props.appendComponent;
  const values = props.value.concat("");
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);

  const { orderable = true } = props;

  function valueChanged(idx: number, value: string) {
    const newValues = props.value.slice();
    newValues[idx] = value;

    // if we cleared the last string, delete it from the array entirely
    if (!value && idx === newValues.length - 1) {
      newValues.splice(newValues.length - 1);
    }

    props.setValue(newValues);
  }

  function removeValue(idx: number) {
    const newValues = props.value.filter((_v, i) => i !== idx);

    props.setValue(newValues);
  }

  function handleDragStart(event: React.DragEvent<HTMLElement>, idx: number) {
    event.dataTransfer.dropEffect = "move";
    setDraggedIdx(idx);
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.dataTransfer.dropEffect = "move";
    e.preventDefault();

    if (
      draggedIdx === null ||
      draggedIdx === idx ||
      idx === values.length - 1
    ) {
      return;
    }

    const newValues = [...props.value];
    const draggedValue = newValues[draggedIdx];
    newValues.splice(draggedIdx, 1);
    newValues.splice(idx, 0, draggedValue);

    props.setValue(newValues);
    setDraggedIdx(idx);
  }

  function handleDragEnd() {
    setDraggedIdx(null);
  }

  return (
    <>
      <div className={`string-list-input ${props.errors ? "is-invalid" : ""}`}>
        <Box component="div">
          {values.map((v, i) => (
            <Box
              className={props.className}
              key={i}
              onDragOver={(e) => handleDragOver(e, i)}
              sx={{ display: 'flex', gap: 1, mb: 1 }}
            >
              <Input
                value={v}
                setValue={(value) => valueChanged(i, value)}
                placeholder={props.placeholder}
                className={props.errorIdx?.includes(i) ? "is-invalid" : ""}
                readOnly={props.readOnly}
              />
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                {AppendComponent && <AppendComponent value={v} />}
                {!props.readOnly && values.length > 2 && orderable && (
                  <IconButton
                    color="secondary"
                    className="drag-handle minimal"
                    draggable={i !== values.length - 1}
                    disabled={i === values.length - 1}
                    onDragStart={(e) => handleDragStart(e, i)}
                    onDragEnd={handleDragEnd}
                    size="small"
                  >
                    <Icon icon={faGripVertical} />
                  </IconButton>
                )}
                {!props.readOnly && (
                  <IconButton
                    color="error"
                    onClick={() => removeValue(i)}
                    disabled={i === values.length - 1}
                    size="small"
                  >
                    <Icon icon={faMinus} />
                  </IconButton>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      </div>
      <div className="invalid-feedback mt-n2">{props.errors}</div>
    </>
  );
};
