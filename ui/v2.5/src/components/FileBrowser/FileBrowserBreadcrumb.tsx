import React from "react";
import { Breadcrumbs, Typography } from "@mui/material";
import * as GQL from "src/core/generated-graphql";

interface IFileBrowserBreadcrumbProps {
  folderId: string;
  onNavigate: (id: string) => void;
}

export const FileBrowserBreadcrumb: React.FC<IFileBrowserBreadcrumbProps> = ({
  folderId,
  onNavigate,
}) => {
  const { data } = GQL.useFindFolderHierarchyForIDsQuery({
    variables: { ids: [folderId] },
  });

  const folder = data?.findFolders.folders[0];
  if (!folder) return null;

  // parent_folders is ordered from immediate parent to top-level; reverse for display
  const ancestors = [...(folder.parent_folders ?? [])].reverse();
  const crumbs = [...ancestors, { id: folder.id, basename: folder.basename }];

  return (
    <Breadcrumbs sx={{ mb: 1, px: 1 }}>
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        if (isLast) {
          return (
            <Typography key={crumb.id} color="text.primary" fontWeight="medium">
              {crumb.basename}
            </Typography>
          );
        }
        return (
          <Typography
            key={crumb.id}
            component="span"
            color="text.secondary"
            sx={{ cursor: "pointer", "&:hover": { color: "text.primary" } }}
            onClick={() => onNavigate(crumb.id)}
          >
            {crumb.basename}
          </Typography>
        );
      })}
    </Breadcrumbs>
  );
};
