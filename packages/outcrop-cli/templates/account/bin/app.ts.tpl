#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { createAccountBaseline } from "@rpallas/outcrop-account";
import config from "../account.config";
import { modules } from "../lib/modules";

const app = new App();
createAccountBaseline(app, { config, modules });
