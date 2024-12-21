import React from "react";

import type { Row, Table } from "@tanstack/react-table";

type TableCheckboxProps<T> = { row?: Row<T>; table?: Table<T> };

const TableAllCheckbox: React.FC<TableCheckboxProps<any>> = ({ table }) => {
  if (!table) {
    return null;
  }
  const isSomeRowsSelected =
    !table.getIsAllPageRowsSelected() && table.getIsSomeRowsSelected();
  return (
    <label className="p-checkbox--inline">
      <input
        aria-checked={isSomeRowsSelected ? "mixed" : undefined}
        aria-label="select all"
        className="p-checkbox__input"
        type="checkbox"
        {...{
          checked: isSomeRowsSelected || table.getIsAllPageRowsSelected(),
          onChange: () => {
            if (table.getIsAllPageRowsSelected()) {
              table.resetRowSelection();
            } else {
              table.setRowSelection((previousSelection) => {
                return {
                  ...previousSelection,
                  ...Object.keys(table.getRowModel().rowsById).reduce(
                    (acc, id) => ({ ...acc, [id]: true }),
                    {}
                  ),
                };
              });
            }
          },
        }}
      />
      <span className="p-checkbox__label" />
    </label>
  );
};

const TableGroupCheckbox: React.FC<TableCheckboxProps<any>> = ({ row }) => {
  if (!row) {
    return null;
  }
  const isSomeSubRowsSelected =
    !row.getIsAllSubRowsSelected() && row.getIsSomeSelected();
  return (
    <label className="p-checkbox--inline">
      <input
        aria-checked={isSomeSubRowsSelected ? "mixed" : undefined}
        aria-label={row.original?.name}
        className="p-checkbox__input"
        type="checkbox"
        {...{
          checked: isSomeSubRowsSelected || row.getIsAllSubRowsSelected(),
          disabled: !row.getCanSelect(),
          onChange: () => {
            if (row?.getIsAllSubRowsSelected()) {
              row?.toggleSelected(false);
              row.subRows.forEach((subRow) => subRow.toggleSelected(false));
            } else {
              row?.toggleSelected(true);
              row.subRows.forEach((subRow) => subRow.toggleSelected(true));
            }
          },
        }}
      />
      <span className="p-checkbox__label" />
    </label>
  );
};

const TableCheckbox: React.FC<TableCheckboxProps<any>> & {
  All: React.FC<TableCheckboxProps<any>>;
  Group: React.FC<TableCheckboxProps<any>>;
} = ({ row }) => {
  if (!row) {
    return null;
  }
  return (
    <label className="p-checkbox--inline">
      <input
        aria-label={row.original.name}
        className="p-checkbox__input"
        type="checkbox"
        {...{
          checked: row.getIsSelected(),
          disabled: !row.getCanSelect(),
          onChange: row.getToggleSelectedHandler(),
        }}
      />
      <span className="p-checkbox__label" />
    </label>
  );
};

TableCheckbox.All = TableAllCheckbox;
TableCheckbox.Group = TableGroupCheckbox;

export default TableCheckbox;
