import React from "react";

import { Button, Icon, Tooltip } from "@canonical/react-components";
import type { Row } from "@tanstack/react-table";
import "./_index.scss";
import classNames from "classnames";

type RowActionsProps<T> = { row: Row<T>; onDelete?: any };

const GroupRowActions: React.FC<RowActionsProps<any>> = ({ row }) => (
  <Button
    appearance="base"
    dense
    hasIcon
    onClick={() => {
      row.toggleExpanded();
    }}
    type="button"
  >
    {row.getIsExpanded() ? (
      <Icon name="minus">Collapse</Icon>
    ) : (
      <Icon name="plus">Expand</Icon>
    )}
  </Button>
);

// Currently, only has deletion action, other actions could later be implemented from MAAS Site Manager
const RowActions: React.FC<RowActionsProps<any>> & {
  Group: React.FC<RowActionsProps<any>>;
} = ({ row, onDelete }) => {
  const isDisabled = row.getIsGrouped()
    ? !row.getCanSelectSubRows()
    : !row.getCanSelect();
  return (
    <div
      className={classNames(
        "table-actions u-flex u-align--right table-actions-bordered"
      )}
    >
      <Tooltip position="left">
        <Button
          appearance="base"
          className="is-dense u-table-cell-padding-overlap table-actions-btn"
          disabled={isDisabled}
          hasIcon
          onClick={onDelete}
          type="button"
        >
          <i className="p-icon--delete">Delete</i>
        </Button>
      </Tooltip>
    </div>
  );
};

RowActions.Group = GroupRowActions;

export default RowActions;
