import React from "react";
import { Route, Switch } from "react-router-dom";
import { Helmet } from "react-helmet";
import { FapTapGrid } from "./FapTapGrid";
import { FapTapPlayerPage } from "./FapTapPlayerPage";

/**
 * FapTap — flat 2D browse + playback for the FapTap sidecar catalog, the
 * no-headset counterpart of the immersive VR Home's FapTap tab. Both talk to
 * the same read-only `/faptap/*` route group; the nav entry (MainNavbar) and
 * the grid gate themselves on the sidecar database being present.
 */
const FapTap: React.FC = () => {
  return (
    <>
      <Helmet>
        <title>FapTap</title>
      </Helmet>
      <Switch>
        <Route exact path="/faptap" component={FapTapGrid} />
        <Route path="/faptap/:id" component={FapTapPlayerPage} />
      </Switch>
    </>
  );
};

export default FapTap;
