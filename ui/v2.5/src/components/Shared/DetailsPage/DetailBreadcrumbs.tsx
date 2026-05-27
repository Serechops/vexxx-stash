import React from "react";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import { Link as RouterLink } from "react-router-dom";

export interface IBreadcrumb {
  label: string;
  to?: string;
}

interface IDetailBreadcrumbsProps {
  crumbs: IBreadcrumb[];
}

/**
 * Lightweight breadcrumb row for entity detail pages.
 *
 * Usage:
 *   <DetailBreadcrumbs
 *     crumbs={[{ label: "Scenes", to: "/scenes" }, { label: scene.title }]}
 *   />
 */
export const DetailBreadcrumbs: React.FC<IDetailBreadcrumbsProps> = ({
  crumbs,
}) => (
  <Breadcrumbs
    separator={<NavigateNextIcon fontSize="small" />}
    aria-label="breadcrumb"
    sx={{ mb: 1.5, "& .MuiBreadcrumbs-ol": { flexWrap: "nowrap" } }}
  >
    {crumbs.map((crumb, i) => {
      const isLast = i === crumbs.length - 1;
      if (isLast || !crumb.to) {
        return (
          <Typography
            key={i}
            variant="caption"
            color={isLast ? "text.primary" : "text.secondary"}
            noWrap
            sx={{ maxWidth: 240 }}
          >
            {crumb.label}
          </Typography>
        );
      }
      return (
        <Link
          key={i}
          component={RouterLink}
          to={crumb.to}
          underline="hover"
          color="text.secondary"
          variant="caption"
          noWrap
          sx={{ maxWidth: 200, display: "block" }}
        >
          {crumb.label}
        </Link>
      );
    })}
  </Breadcrumbs>
);
