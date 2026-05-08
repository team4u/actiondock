import { Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
import { renderAccessTokenDetail } from "../../lib/render.js";
export default class AccessTokenCreateCommand extends BaseCommand {
    static description = "Create an ActionDock access token";
    static flags = {
        ...BaseCommand.baseFlags,
        name: Flags.string({ description: "Access token name" }),
        ...serverTokenFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { flags } = await this.parse(AccessTokenCreateCommand);
        try {
            const item = await createClient(flags).createAccessToken(flags.name);
            flags.json ? this.printJson(item) : this.log(renderAccessTokenDetail(item));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
