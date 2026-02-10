import {
  Button,
  Checkbox,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  TextField,
  IconButton,
  Stack,
  Box,
  Typography,
} from "@mui/material";
import React, { useState, useMemo, useEffect } from "react";
import { FormattedMessage, IntlShape, useIntl } from "react-intl";
import * as GQL from "src/core/generated-graphql";
import { Icon } from "../Icon";
import cx from "classnames";
import {
  faAnglesUp,
  faChevronDown,
  faChevronRight,
  faRotate,
  faWarning,
} from "@fortawesome/free-solid-svg-icons";
import { SettingModal } from "src/components/Settings/Inputs";
import * as yup from "yup";
import { FormikErrors, yupToFormErrors } from "formik";
import { AlertModal } from "../Alert";
import { LoadingIndicator } from "../LoadingIndicator";
import { ApolloError } from "@apollo/client";
import { ClearableInput } from "../ClearableInput";

function packageKey(
  pkg: Pick<GQL.Package, "package_id" | "sourceURL">
): string {
  return `${pkg.sourceURL}-${pkg.package_id}`;
}

function displayVersion(intl: IntlShape, version: string | undefined | null) {
  if (!version) return intl.formatMessage({ id: "package_manager.unknown" });

  return version;
}

function displayDate(intl: IntlShape, date: string | undefined | null) {
  if (!date) return;

  const d = new Date(date);

  return `${intl.formatDate(d, {
    timeZone: "utc",
  })} ${intl.formatTime(d, {
    timeZone: "utc",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  })}`;
}

interface IPackage {
  package_id: string;
  name: string;
}

function filterPackages<T extends IPackage>(packages: T[], filter: string) {
  if (!filter) return packages;

  return packages.filter((pkg) => {
    return (
      pkg.name.toLowerCase().includes(filter.toLowerCase()) ||
      pkg.package_id.toLowerCase().includes(filter.toLowerCase())
    );
  });
}

export type InstalledPackage = Omit<GQL.Package, "requires">;

function hasUpgrade(pkg: InstalledPackage) {
  if (!pkg.date || !pkg.source_package?.date) return false;

  const pkgDate = new Date(pkg.date);
  const upgradeDate = new Date(pkg.source_package.date);
  return upgradeDate > pkgDate;
}

const InstalledPackageRow: React.FC<{
  loading?: boolean;
  pkg: InstalledPackage;
  selected: boolean;
  togglePackage: () => void;
  updatesLoaded: boolean;
}> = ({ loading, pkg, selected, togglePackage, updatesLoaded }) => {
  const intl = useIntl();

  const updateAvailable = useMemo(() => {
    if (!updatesLoaded) return false;
    return hasUpgrade(pkg);
  }, [updatesLoaded, pkg]);

  return (
    <TableRow className={cx({ "package-update-available": updateAvailable })}>
      <TableCell padding="checkbox">
        <Checkbox
          checked={selected}
          disabled={loading}
          onChange={() => togglePackage()}
        />
      </TableCell>
      <TableCell>
        <Stack>
          <span className="package-name">{pkg.name}</span>
          <span className="package-id">{pkg.package_id}</span>
        </Stack>
      </TableCell>
      <TableCell>
        <Stack>
          <span className="package-version">
            {displayVersion(intl, pkg.version)}
          </span>
          <span className="package-date">{displayDate(intl, pkg.date)}</span>
        </Stack>
      </TableCell>
      {updatesLoaded && pkg.source_package && (
        <TableCell>
          <Stack>
            <span className="package-latest-version">
              {displayVersion(intl, pkg.source_package.version)}
              {updateAvailable && <Icon icon={faAnglesUp} style={{ marginLeft: '0.25rem' }} />}
            </span>
            <span className="package-latest-date">
              {displayDate(intl, pkg.source_package.date)}
            </span>
          </Stack>
        </TableCell>
      )}
    </TableRow>
  );
};

const InstalledPackagesList: React.FC<{
  filter: string;
  loading?: boolean;
  error?: string;
  updatesLoaded: boolean;
  packages: InstalledPackage[];
  checkedPackages: InstalledPackage[];
  setCheckedPackages: React.Dispatch<React.SetStateAction<InstalledPackage[]>>;
  upgradableOnly: boolean;
}> = ({
  filter,
  packages,
  checkedPackages,
  setCheckedPackages,
  updatesLoaded,
  loading,
  error,
  upgradableOnly,
}) => {
    const checkedMap = useMemo(() => {
      const map: Record<string, boolean> = {};
      for (const pkg of checkedPackages) {
        map[packageKey(pkg)] = true;
      }
      return map;
    }, [checkedPackages]);

    const allChecked = useMemo(() => {
      return packages.length > 0 && checkedPackages.length === packages.length;
    }, [checkedPackages, packages]);

    const filteredPackages = useMemo(() => {
      return filterPackages(packages, filter).filter((pkg) => {
        return !updatesLoaded || !upgradableOnly || hasUpgrade(pkg);
      });
    }, [packages, filter, updatesLoaded, upgradableOnly]);

    function toggleAllChecked() {
      setCheckedPackages(allChecked ? [] : packages.slice());
    }

    function togglePackage(pkg: InstalledPackage) {
      if (loading) return;

      setCheckedPackages((prev) => {
        if (prev.includes(pkg)) {
          return prev.filter((n) => packageKey(n) !== packageKey(pkg));
        } else {
          return [...prev, pkg];
        }
      });
    }

    function renderBody() {
      if (error) {
        return (
          <TableRow>
            <TableCell />
            <TableCell colSpan={100} className="source-error">
              <Stack direction="row" alignItems="center" spacing={1}>
                <Icon icon={faWarning} color="error" />
                <Typography color="error">{error}</Typography>
              </Stack>
            </TableCell>
          </TableRow>
        );
      }

      if (filteredPackages.length === 0) {
        const id = upgradableOnly
          ? "package_manager.no_upgradable"
          : "package_manager.no_packages";
        return (
          <TableRow className="package-manager-no-results">
            <TableCell colSpan={100} align="center">
              <FormattedMessage id={id} />
            </TableCell>
          </TableRow>
        );
      }

      return filteredPackages.map((pkg) => (
        <InstalledPackageRow
          key={packageKey(pkg)}
          loading={loading}
          pkg={pkg}
          selected={checkedMap[packageKey(pkg)] ?? false}
          togglePackage={() => togglePackage(pkg)}
          updatesLoaded={updatesLoaded}
        />
      ));
    }

    return (
      <div className="package-manager-table-container">
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={allChecked ?? false}
                    onChange={toggleAllChecked}
                    disabled={loading && packages.length > 0}
                  />
                </TableCell>
                <TableCell>
                  <FormattedMessage id="package_manager.package" />
                </TableCell>
                <TableCell>
                  <FormattedMessage id="package_manager.installed_version" />
                </TableCell>
                {updatesLoaded ? (
                  <TableCell>
                    <FormattedMessage id="package_manager.latest_version" />
                  </TableCell>
                ) : undefined}
              </TableRow>
            </TableHead>
            <TableBody>{renderBody()}</TableBody>
          </Table>
        </TableContainer>
      </div>
    );
  };

const InstalledPackagesToolbar: React.FC<{
  loading?: boolean;
  filter: string;
  setFilter: (s: string) => void;
  checkedPackages: InstalledPackage[];
  onCheckForUpdates: () => void;
  onUpdatePackages: () => void;
  onUninstallPackages: () => void;

  upgradableOnly: boolean;
  setUpgradableOnly: (v: boolean) => void;
}> = ({
  loading,
  checkedPackages,
  onCheckForUpdates,
  onUpdatePackages,
  onUninstallPackages,
  filter,
  setFilter,
  upgradableOnly,
  setUpgradableOnly,
}) => {
    const intl = useIntl();

    return (
      <div className="package-manager-toolbar">
        <ClearableInput
          placeholder={`${intl.formatMessage({ id: "filter" })}...`}
          value={filter}
          setValue={(v) => setFilter(v)}
        />
        {upgradableOnly && (
          <Button
            size="small"
            variant="contained"
            onClick={() => setUpgradableOnly(!upgradableOnly)}
          >
            <FormattedMessage id="package_manager.show_all" />
          </Button>
        )}
        <div style={{ flexGrow: 1 }} />
        <Button
          variant="contained"
          onClick={() => onCheckForUpdates()}
          disabled={loading}
        >
          <FormattedMessage id="package_manager.check_for_updates" />
        </Button>
        <Button
          variant="contained"
          disabled={!checkedPackages.length || loading}
          onClick={() => onUpdatePackages()}
        >
          <FormattedMessage id="package_manager.update" />
        </Button>
        <Button
          variant="outlined"
          color="error"
          disabled={!checkedPackages.length || loading}
          onClick={() => onUninstallPackages()}
        >
          <FormattedMessage id="package_manager.uninstall" />
        </Button>
      </div>
    );
  };

export const InstalledPackages: React.FC<{
  loading?: boolean;
  error?: string;
  packages: InstalledPackage[];
  updatesLoaded: boolean;
  onCheckForUpdates: () => void;
  onUpdatePackages: (packages: InstalledPackage[]) => void;
  onUninstallPackages: (packages: InstalledPackage[]) => void;
}> = ({
  packages,
  onCheckForUpdates,
  updatesLoaded,
  onUpdatePackages,
  onUninstallPackages,
  loading,
  error,
}) => {
    const [checkedPackages, setCheckedPackages] = useState<InstalledPackage[]>(
      []
    );
    const [filter, setFilter] = useState("");
    const [upgradableOnly, setUpgradableOnly] = useState(true);
    const [uninstalling, setUninstalling] = useState(false);

    // sort packages so that those with updates are at the top
    const sortedPackages = useMemo(() => {
      return packages.slice().sort((a, b) => {
        const aHasUpdate = hasUpgrade(a);
        const bHasUpdate = hasUpgrade(b);

        if (aHasUpdate && !bHasUpdate) return -1;
        if (!aHasUpdate && bHasUpdate) return 1;

        // sort by name
        return a.package_id.localeCompare(b.package_id);
      });
    }, [packages]);

    const filteredPackages = useMemo(() => {
      return filterPackages(checkedPackages, filter).filter((pkg) => {
        return !updatesLoaded || !upgradableOnly || hasUpgrade(pkg);
      });
    }, [checkedPackages, filter, updatesLoaded, upgradableOnly]);

    useEffect(() => {
      setCheckedPackages((prev) => {
        const newVal = prev.filter((pkg) =>
          packages.find((p) => packageKey(p) === packageKey(pkg))
        );
        if (newVal.length !== prev.length) {
          return newVal;
        }

        return prev;
      });
    }, [checkedPackages, packages]);

    function confirmUninstall() {
      onUninstallPackages(filteredPackages);
      setUninstalling(false);
    }

    function checkForUpdates() {
      // reset to only show upgradable packages
      setUpgradableOnly(true);
      onCheckForUpdates();
    }

    return (
      <>
        <AlertModal
          show={!!uninstalling}
          text={
            <FormattedMessage
              id="package_manager.confirm_uninstall"
              values={{ number: filteredPackages.length }}
            />
          }
          onConfirm={() => confirmUninstall()}
          onCancel={() => setUninstalling(false)}
        />
        <div className="installed-packages">
          <InstalledPackagesToolbar
            filter={filter}
            setFilter={(f) => setFilter(f)}
            loading={loading}
            checkedPackages={filteredPackages}
            onCheckForUpdates={() => checkForUpdates()}
            onUpdatePackages={() => onUpdatePackages(filteredPackages)}
            onUninstallPackages={() => setUninstalling(true)}
            upgradableOnly={updatesLoaded && upgradableOnly}
            setUpgradableOnly={(v) => setUpgradableOnly(v)}
          />
          <InstalledPackagesList
            filter={filter}
            loading={loading}
            error={error}
            packages={sortedPackages}
            // use original checked packages so that check boxes are not affected by filter
            checkedPackages={checkedPackages}
            setCheckedPackages={setCheckedPackages}
            updatesLoaded={updatesLoaded}
            upgradableOnly={upgradableOnly}
          />
        </div>
      </>
    );
  };

const AvailablePackagesToolbar: React.FC<{
  filter: string;
  setFilter: (s: string) => void;
  loading?: boolean;
  hasSelectedPackages: boolean;
  onInstallPackages: () => void;

  selectedOnly: boolean;
  setSelectedOnly: (v: boolean) => void;
}> = ({
  hasSelectedPackages,
  onInstallPackages,
  loading,
  filter,
  setFilter,
  selectedOnly,
  setSelectedOnly,
}) => {
    const intl = useIntl();

    const selectedOnlyId = !selectedOnly
      ? "package_manager.hide_unselected"
      : "package_manager.show_all";

    return (
      <div className="package-manager-toolbar">
        <ClearableInput
          placeholder={`${intl.formatMessage({ id: "filter" })}...`}
          value={filter}
          setValue={(v) => setFilter(v)}
        />
        {hasSelectedPackages && (
          <Button
            size="small"
            variant="contained"
            onClick={() => setSelectedOnly(!selectedOnly)}
          >
            <FormattedMessage id={selectedOnlyId} />
          </Button>
        )}
        <div style={{ flexGrow: 1 }} />
        <Button
          variant="contained"
          disabled={!hasSelectedPackages || loading}
          onClick={() => onInstallPackages()}
        >
          <FormattedMessage id="package_manager.install" />
        </Button>
      </div>
    );
  };

const EditSourceModal: React.FC<{
  sources: GQL.PackageSource[];
  existing?: GQL.PackageSource;
  onClose: (source?: GQL.PackageSource) => void;
}> = ({ existing, sources, onClose }) => {
  const intl = useIntl();

  const schema = yup.object({
    name: yup
      .string()
      .required()
      .test({
        name: "name",
        test: (value) => {
          if (!value) return true;
          const found = sources.find((s) => s.name === value);
          return !found || found === existing;
        },
        message: intl.formatMessage({ id: "validation.unique" }),
      }),
    url: yup
      .string()
      .required()
      .test({
        name: "url",
        test: (value) => {
          if (!value) return true;
          const found = sources.find((s) => s.url === value);
          return !found || found === existing;
        },
        message: intl.formatMessage({ id: "validation.unique" }),
      }),
    local_path: yup.string().nullable(),
  });

  type InputValues = yup.InferType<typeof schema>;
  function validate(
    v: GQL.PackageSource | undefined
  ): FormikErrors<InputValues> | undefined {
    try {
      schema.validateSync(v, { abortEarly: false });
    } catch (e) {
      return yupToFormErrors(e);
    }
  }

  const headerID = !!existing
    ? "package_manager.edit_source"
    : "package_manager.add_source";

  function renderField(
    v: GQL.PackageSource | undefined,
    setValue: (v: GQL.PackageSource | undefined) => void
  ) {
    const errors = validate(v);

    return (
      <Stack spacing={2}>
        <TextField
          label={<FormattedMessage id="package_manager.source.name" />}
          placeholder={intl.formatMessage({ id: "package_manager.source.name" })}
          value={v?.name ?? ""}
          onChange={(e) => setValue({ ...v!, name: e.target.value })}
          error={!!errors?.name}
          helperText={errors?.name}
          fullWidth
          variant="outlined"
          size="small"
        />

        <TextField
          label={<FormattedMessage id="package_manager.source.url" />}
          placeholder={intl.formatMessage({ id: "package_manager.source.url" })}
          value={v?.url ?? ""}
          onChange={(e) => setValue({ ...v!, url: e.target.value.trim() })}
          error={!!errors?.url}
          helperText={errors?.url}
          fullWidth
          variant="outlined"
          size="small"
        />

        <Box>
          <TextField
            label={<FormattedMessage id="package_manager.source.local_path.heading" />}
            placeholder={intl.formatMessage({ id: "package_manager.source.local_path.heading" })}
            value={v?.local_path ?? ""}
            onChange={(e) => setValue({ ...v!, local_path: e.target.value })}
            error={!!errors?.local_path}
            helperText={errors?.local_path}
            fullWidth
            variant="outlined"
            size="small"
          />
          <Typography variant="caption" color="textSecondary">
            <FormattedMessage id="package_manager.source.local_path.description" />
          </Typography>
        </Box>
      </Stack>
    );
  }

  return (
    <SettingModal<GQL.PackageSource>
      headingID={headerID}
      value={existing ?? { url: "", name: "" }}
      validate={(v) => validate(v) === undefined}
      renderField={renderField}
      close={onClose}
    />
  );
};

export type RemotePackage = Omit<GQL.Package, "requires"> & {
  requires: { package_id: string }[];
};

const AvailablePackageRow: React.FC<{
  disabled?: boolean;
  pkg: RemotePackage;
  requiredBy: RemotePackage[];
  selected: boolean;
  togglePackage: () => void;
  renderDescription?: (pkg: RemotePackage) => React.ReactNode;
}> = ({
  disabled,
  pkg,
  requiredBy,
  selected,
  togglePackage,
  renderDescription = () => undefined,
}) => {
    const intl = useIntl();

    function renderRequiredBy() {
      if (!requiredBy.length) return;

      return (
        <div className="package-required-by">
          <FormattedMessage
            id="package_manager.required_by"
            values={{ packages: requiredBy.map((p) => p.name).join(", ") }}
          />
        </div>
      );
    }

    return (
      <TableRow>
        <TableCell padding="checkbox" colSpan={2}>
          <Checkbox
            checked={selected ?? false}
            onChange={() => togglePackage()}
            disabled={disabled}
          />
        </TableCell>
        <TableCell className="package-cell" onClick={() => togglePackage()}>
          <Stack>
            <span className="package-name">{pkg.name}</span>
            <span className="package-id">{pkg.package_id}</span>
          </Stack>
        </TableCell>
        <TableCell>
          <Stack>
            <span className="package-version">
              {displayVersion(intl, pkg.version)}
            </span>
            <span className="package-date">{displayDate(intl, pkg.date)}</span>
          </Stack>
        </TableCell>
        <TableCell>
          {renderRequiredBy()}
          <div>{renderDescription(pkg)}</div>
        </TableCell>
      </TableRow>
    );
  };

const SourcePackagesList: React.FC<{
  filter: string;
  disabled?: boolean;
  source: GQL.PackageSource;
  loadSource: () => Promise<RemotePackage[]>;
  selectedOnly: boolean;
  selectedPackages: RemotePackage[];
  allowSelectAll?: boolean;
  setSelectedPackages: React.Dispatch<React.SetStateAction<RemotePackage[]>>;
  renderDescription?: (pkg: RemotePackage) => React.ReactNode;
  editSource: () => void;
  deleteSource: () => void;
}> = ({
  source,
  loadSource,
  allowSelectAll,
  selectedOnly,
  selectedPackages,
  setSelectedPackages,
  disabled,
  filter,
  renderDescription,
  editSource,
  deleteSource,
}) => {
    const intl = useIntl();
    const [packages, setPackages] = useState<RemotePackage[]>();
    const [sourceOpen, setSourceOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string>();

    const checkedMap = useMemo(() => {
      const map: Record<string, boolean> = {};

      selectedPackages.forEach((pkg) => {
        map[pkg.package_id] = true;
      });
      return map;
    }, [selectedPackages]);

    const sourceChecked = useMemo(() => {
      return packages && Object.keys(checkedMap).length === packages.length;
    }, [checkedMap, packages]);

    const filteredPackages = useMemo(() => {
      if (!packages) return [];

      let ret = filterPackages(packages, filter);

      if (selectedOnly) {
        ret = ret.filter((pkg) => checkedMap[pkg.package_id]);
      }

      return ret;
    }, [filter, packages, selectedOnly, checkedMap]);

    function toggleSource() {
      if (disabled || packages === undefined) return;

      if (sourceChecked) {
        setSelectedPackages([]);
      } else {
        setSelectedPackages(packages.slice());
      }
    }

    async function loadPackages() {
      // need to load
      setLoading(true);
      setLoadError(undefined);
      try {
        const loaded = await loadSource();
        setPackages(loaded);
      } catch (e) {
        setLoadError((e as ApolloError).message);
      } finally {
        setLoading(false);
      }
    }

    function toggleSourceOpen() {
      if (sourceOpen) {
        setLoadError(undefined);
        setSourceOpen(false);
      } else {
        if (packages === undefined) {
          loadPackages();
        }
        setSourceOpen(true);
      }
    }

    function renderContents() {
      if (loading) {
        return (
          <TableRow>
            <TableCell colSpan={2}></TableCell>
            <TableCell colSpan={3}>
              <LoadingIndicator inline small />
            </TableCell>
          </TableRow>
        );
      }

      if (loadError) {
        return (
          <TableRow>
            <TableCell colSpan={2}></TableCell>
            <TableCell colSpan={3} className="source-error">
              <Stack direction="row" alignItems="center" spacing={2}>
                <Icon icon={faWarning} color="error" />
                <Typography color="error">{loadError}</Typography>
                <IconButton
                  size="small"
                  onClick={() => loadPackages()}
                  title={intl.formatMessage({ id: "actions.reload" })}
                >
                  <Icon icon={faRotate} />
                </IconButton>
              </Stack>
            </TableCell>
          </TableRow>
        );
      }

      if (!sourceOpen) {
        return null;
      }

      function getRequiredPackages(pkg: RemotePackage) {
        const ret: RemotePackage[] = [];

        function check(pkg_id: string) {
          if (!packages || !pkg_id) return;
          const p = packages.find((p) => p.package_id === pkg_id);

          if (p && checkedMap[p.package_id]) {
            ret.push(p);
          }
        }

        if (pkg.requires?.length) {
          pkg.requires.forEach((p) => check(p.package_id));
        }

        return ret;
      }

      if (filteredPackages.length === 0) {
        return (
          <TableRow className="package-manager-no-results">
            <TableCell colSpan={100} align="center">
              <FormattedMessage id="package_manager.no_packages" />
            </TableCell>
          </TableRow>
        );
      }

      function setPackage(pkg: RemotePackage, value: boolean) {
        setSelectedPackages((prev) => {
          if (value) {
            if (prev.find((p) => p.package_id === pkg.package_id)) {
              return prev;
            }
            return [...prev, pkg];
          } else {
            return prev.filter((p) => p.package_id !== pkg.package_id);
          }
        });
      }

      function togglePackage(pkg: RemotePackage) {
        if (disabled) return;

        setPackage(pkg, !checkedMap[pkg.package_id]);
      }

      return filteredPackages.map((pkg) => (
        <AvailablePackageRow
          key={packageKey(pkg)}
          pkg={pkg}
          requiredBy={getRequiredPackages(pkg)}
          selected={checkedMap[pkg.package_id] ?? false}
          togglePackage={() => togglePackage(pkg)}
          disabled={disabled}
          renderDescription={renderDescription}
        />
      ));
    }

    return (
      <>
        <TableRow className="source-header">
          <TableCell padding="checkbox">
            {allowSelectAll && (
              <Checkbox
                checked={sourceChecked ?? false}
                indeterminate={
                  packages &&
                  !sourceChecked &&
                  Object.keys(checkedMap).length > 0
                }
                onChange={toggleSource}
                disabled={disabled || loading || packages === undefined}
              />
            )}
          </TableCell>
          <TableCell>
            <IconButton
              size="small"
              onClick={() => toggleSourceOpen()}
            >
              <Icon icon={sourceOpen ? faChevronDown : faChevronRight} />
            </IconButton>
          </TableCell>
          <TableCell>
            <span className="source-name">{source.name}</span>
            <br />
            <span className="source-url">{source.url}</span>
          </TableCell>
          <TableCell colSpan={2}>
            <Box display="flex" justifyContent="flex-end">
              <Button
                variant="outlined"
                size="small"
                onClick={editSource}
                sx={{ mr: 2 }}
              >
                <FormattedMessage id="actions.edit" />
              </Button>
              <Button
                variant="outlined"
                size="small"
                color="error"
                onClick={deleteSource}
              >
                <FormattedMessage id="actions.delete" />
              </Button>
            </Box>
          </TableCell>
        </TableRow>
        {renderContents()}
      </>
    );
  };

const AvailablePackagesList: React.FC<{
  filter: string;
  loading?: boolean;
  sources: GQL.PackageSource[];
  renderDescription?: (pkg: RemotePackage) => React.ReactNode;
  loadSource: (source: string) => Promise<RemotePackage[]>;
  selectedPackages: Record<string, RemotePackage[]>; // map of source url to selected packages
  setSelectedPackages: React.Dispatch<
    React.SetStateAction<Record<string, RemotePackage[]>>
  >;
  selectedOnly: boolean;
  allowSourceSelectAll?: boolean;
  addSource: (src: GQL.PackageSource) => void;
  editSource: (existing: GQL.PackageSource, changed: GQL.PackageSource) => void;
  deleteSource: (source: GQL.PackageSource) => void;
}> = ({
  sources,
  loadSource,
  selectedPackages,
  setSelectedPackages,
  loading,
  filter,
  renderDescription,
  selectedOnly,
  addSource,
  editSource,
  deleteSource,
  allowSourceSelectAll,
}) => {
    const [deletingSource, setDeletingSource] = useState<GQL.PackageSource>();
    const [editingSource, setEditingSource] = useState<GQL.PackageSource>();
    const [addingSource, setAddingSource] = useState(false);

    function onDeleteSource() {
      if (!deletingSource) return;

      deleteSource(deletingSource);
      setDeletingSource(undefined);
    }

    function setSelectedSourcePackages(
      src: GQL.PackageSource,
      v: RemotePackage[] | ((prevState: RemotePackage[]) => RemotePackage[])
    ) {
      setSelectedPackages((prev) => {
        const existing = prev[src.url] ?? [];
        const next = typeof v === "function" ? v(existing) : v;

        return {
          ...prev,
          [src.url]: next,
        };
      });
    }

    function renderBody() {
      if (sources.length === 0) {
        return (
          <TableRow className="package-manager-no-results">
            <TableCell colSpan={5} align="center">
              <FormattedMessage id="package_manager.no_sources" />
              <br />
              <Button
                size="small"
                variant="contained"
                onClick={() => setAddingSource(true)}
              >
                <FormattedMessage id="package_manager.add_source" />
              </Button>
            </TableCell>
          </TableRow>
        );
      }

      return (
        <>
          {sources.map((src) => (
            <SourcePackagesList
              key={src.url}
              filter={filter}
              disabled={loading}
              source={src}
              renderDescription={renderDescription}
              loadSource={() => loadSource(src.url)}
              selectedOnly={selectedOnly}
              selectedPackages={selectedPackages[src.url] ?? []}
              setSelectedPackages={(v) => setSelectedSourcePackages(src, v)}
              editSource={() => setEditingSource(src)}
              deleteSource={() => setDeletingSource(src)}
              allowSelectAll={allowSourceSelectAll}
            />
          ))}
          <TableRow className="add-package-source">
            <TableCell colSpan={2}></TableCell>
            <TableCell colSpan={3}>
              <Button
                size="small"
                variant="contained"
                color="primary"
                onClick={() => setAddingSource(true)}
              >
                <FormattedMessage id="package_manager.add_source" />
              </Button>
            </TableCell>
          </TableRow>
        </>
      );
    }

    return (
      <>
        <AlertModal
          show={!!deletingSource}
          text={
            <FormattedMessage
              id="package_manager.confirm_delete_source"
              values={{ name: deletingSource?.name, url: deletingSource?.url }}
            />
          }
          onConfirm={() => onDeleteSource()}
          onCancel={() => setDeletingSource(undefined)}
        />

        {editingSource || addingSource ? (
          <EditSourceModal
            sources={sources}
            existing={editingSource}
            onClose={(v) => {
              if (v) {
                if (addingSource) addSource(v);
                else if (editingSource) editSource(editingSource, v);
              }
              setEditingSource(undefined);
              setAddingSource(false);
            }}
          />
        ) : undefined}

        <div className="package-manager-table-container">
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell className="check-cell"></TableCell>
                  <TableCell className="collapse-cell"></TableCell>
                  <TableCell>
                    <FormattedMessage id="package_manager.package" />
                  </TableCell>
                  <TableCell>
                    <FormattedMessage id="package_manager.version" />
                  </TableCell>
                  <TableCell>
                    <FormattedMessage id="package_manager.description" />
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>{renderBody()}</TableBody>
            </Table>
          </TableContainer>
        </div>
      </>
    );
  };

export const AvailablePackages: React.FC<{
  loading?: boolean;
  sources: GQL.PackageSource[];
  renderDescription?: (pkg: RemotePackage) => React.ReactNode;
  loadSource: (source: string) => Promise<RemotePackage[]>;
  onInstallPackages: (packages: GQL.PackageSpecInput[]) => void;
  addSource: (src: GQL.PackageSource) => void;
  editSource: (existing: GQL.PackageSource, changed: GQL.PackageSource) => void;
  deleteSource: (source: GQL.PackageSource) => void;
  allowSelectAll?: boolean;
}> = ({
  sources,
  loadSource,
  onInstallPackages,
  loading,
  renderDescription,
  addSource,
  editSource,
  deleteSource,
  allowSelectAll,
}) => {
    const [checkedPackages, setCheckedPackages] = useState<
      Record<string, RemotePackage[]>
    >({});
    const [filter, setFilter] = useState("");
    const [selectedOnly, setSelectedOnly] = useState(false);

    const hasPackagesSelected = useMemo(() => {
      return Object.values(checkedPackages).some((s) => s.length > 0);
    }, [checkedPackages]);

    // if no packages are selected, set selected only to false
    useEffect(() => {
      if (!hasPackagesSelected) {
        setSelectedOnly(false);
      }
    }, [hasPackagesSelected]);

    function toPackageSpecInput(): GQL.PackageSpecInput[] {
      const ret: GQL.PackageSpecInput[] = [];
      Object.keys(checkedPackages).forEach((sourceURL) => {
        checkedPackages[sourceURL].forEach((pkg) => {
          ret.push({ id: pkg.package_id, sourceURL });
        });
      });
      return ret;
    }

    return (
      <div className="available-packages">
        <AvailablePackagesToolbar
          filter={filter}
          setFilter={(f) => setFilter(f)}
          loading={loading}
          hasSelectedPackages={hasPackagesSelected}
          onInstallPackages={() => onInstallPackages(toPackageSpecInput())}
          selectedOnly={selectedOnly}
          setSelectedOnly={(v) => setSelectedOnly(v)}
        />
        <AvailablePackagesList
          filter={filter}
          loading={loading}
          sources={sources}
          renderDescription={renderDescription}
          loadSource={loadSource}
          selectedOnly={selectedOnly}
          selectedPackages={checkedPackages}
          setSelectedPackages={setCheckedPackages}
          addSource={addSource}
          editSource={editSource}
          deleteSource={deleteSource}
          allowSourceSelectAll={allowSelectAll}
        />
      </div>
    );
  };
