import React from "react";
import { createRoot } from "react-dom/client";
import { FriendsApp } from "../app/FriendsApp";

createRoot(document.getElementById("root")!).render(<FriendsApp surface="side-panel" />);
