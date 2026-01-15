import React, { useMemo } from "react";
import { Table, TableHead, TableBody, TableRow, TableCell, Checkbox, Box } from "@mui/material";
import { CheckBoxSelect } from "../Shared/Select";

export interface IColumn {
  label: string;
  value: string;
  mandatory?: boolean;
}

export const ColumnSelector: React.FC<{
  selected: string[];
  allColumns: IColumn[];
  setSelected: (selected: string[]) => void;
}> = ({ selected, allColumns, setSelected }) => {
  const disableOptions = useMemo(() => {
    return allColumns.map((col) => {
      return {
        ...col,
        isDisabled: col.mandatory,
      };
    });
  }, [allColumns]);

  const selectedColumns = useMemo(() => {
    return disableOptions.filter((col) => selected.includes(col.value));
  }, [selected, disableOptions]);

  return (
    <CheckBoxSelect
      options={disableOptions}
      selectedOptions={selectedColumns}
      onChange={(v) => {
        setSelected(v.map((col) => col.value));
      }}
    />
  );
};

interface IListTableProps<T> {
  className?: string;
  items: T[];
  columns: string[];
  setColumns: (columns: string[]) => void;
  allColumns: IColumn[];
  selectedIds: Set<string>;
  onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void;
  renderCell: (column: IColumn, item: T, index: number) => React.ReactNode;
}

export const ListTable = <T extends { id: string }>(
  props: IListTableProps<T>
) => {
  const {
    className,
    items,
    columns,
    setColumns,
    allColumns,
    selectedIds,
    onSelectChange,
    renderCell,
  } = props;

  const visibleColumns = useMemo(() => {
    return allColumns.filter(
      (col) => col.mandatory || columns.includes(col.value)
    );
  }, [columns, allColumns]);

  const renderObjectRow = (item: T, index: number) => {
    let shiftKey = false;

    return (
      <TableRow key={item.id}>
        <TableCell padding="checkbox" sx={{ width: 20 }}>
          <Checkbox
            checked={selectedIds.has(item.id)}
            onChange={() =>
              onSelectChange(item.id, !selectedIds.has(item.id), shiftKey)
            }
            onClick={(event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
              shiftKey = event.shiftKey;
              event.stopPropagation();
            }}
            size="small"
          />
        </TableCell>

        {visibleColumns.map((column) => (
          <TableCell key={column.value} className={`${column.value}-data`}>
            {renderCell(column, item, index)}
          </TableCell>
        ))}
      </TableRow>
    );
  };

  const columnHeaders = useMemo(() => {
    return visibleColumns.map((column) => (
      <TableCell key={column.value} className={`${column.value}-head`}>
        {column.label}
      </TableCell>
    ));
  }, [visibleColumns]);

  return (
    <Box className={className} sx={{
      display: "grid",
      marginBottom: 2,
      maxHeight: "78vh",
      overflowX: "auto",
      position: "relative",
    }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox" sx={{ width: 20 }}>
              <div
                className="d-inline-block"
                data-toggle="popover"
                data-trigger="focus"
              >
                <ColumnSelector
                  allColumns={allColumns}
                  selected={columns}
                  setSelected={setColumns}
                />
              </div>
            </TableCell>

            {columnHeaders}
          </TableRow>
        </TableHead>
        <TableBody>{items.map(renderObjectRow)}</TableBody>
      </Table>
    </Box>
  );
};
