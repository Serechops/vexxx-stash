import React from "react";
import { Route, Switch } from "react-router-dom";
import { Helmet } from "react-helmet";
import { useTitleProps } from "src/hooks/title";
import { PlaylistList } from "./PlaylistList";
import { PlaylistDetails } from "./PlaylistDetails";
import { PlaylistCreate } from "./PlaylistCreate";
import { PlaylistPlayer } from "./PlaylistPlayer";

const PlaylistRoutes: React.FC = () => {
  const titleProps = useTitleProps({ id: "playlists" });
  
  return (
    <>
      <Helmet {...titleProps} />
      <Switch>
        <Route exact path="/playlists" component={PlaylistList} />
        <Route exact path="/playlists/new" component={PlaylistCreate} />
        <Route exact path="/playlists/:id/play" component={PlaylistPlayer} />
        <Route path="/playlists/:id" component={PlaylistDetails} />
      </Switch>
    </>
  );
};

export default PlaylistRoutes;
