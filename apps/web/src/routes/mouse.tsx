import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { mouseQuery, searchState } from "../device/queries";
import { ConnectEmpty } from "../screens/connect";
import { MouseOverview } from "../screens/mouse";

const route = getRouteApi("/mouse");

const MouseScreen = () => {
  const source = route.useSearch().state ?? "device";
  const { data } = useSuspenseQuery(mouseQuery(source));

  return data.link === "none" ? (
    <ConnectEmpty source={source} />
  ) : (
    <MouseOverview snapshot={data} source={source} />
  );
};

export const Route = createFileRoute("/mouse")({
  component: MouseScreen,
  validateSearch: searchState,
});
