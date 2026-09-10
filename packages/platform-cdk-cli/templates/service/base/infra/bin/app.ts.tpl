#!/usr/bin/env node
import { PlatformApp } from "@rpallas/platform-cdk";
import config from "../../platform.config";
import { {{Service}}Stack } from "../lib/service-stack";

const app = new PlatformApp({ config });
new {{Service}}Stack(app, "Service");
