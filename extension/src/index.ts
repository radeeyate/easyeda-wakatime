const semiver = require("semiver");
const ini = require("ini")
import * as extensionConfig from '../extension.json';

export const activate = (): void => {
    eda.sys_Log.add(`[${TITLE}] Activated`, ESYS_LogType.INFO);
    initializeWakatime();
};

const EASYEDA_VERSION = "2.2.34.6";
const VERSION = extensionConfig.version;
const TITLE = "EasyEDA Wakatime"
const HEARTBEAT_INTERVAL = 15000;
const INACTIVITY_TIMEOUT = 30000;
const LAST_PCB_EVENT_TIME_KEY = "lastPcbEventTime";
const COMMON_HEADERS = {
    'Accept': 'application/json',
};

let apiURL: string | undefined;
let apiKey: string | undefined;

const checkApiCredentials = async (): Promise<boolean> => {
    apiURL = await eda.sys_Storage.getExtensionUserConfig("apiURL");
    apiKey = await eda.sys_Storage.getExtensionUserConfig("apiKey");

    if (!apiURL || !apiKey) {
        eda.sys_MessageBox.showInformationMessage(
            "Please set your Wakatime API URL and API Key in the settings. You can do this by clicking EasyEDA Wakatime > Settings. If you do that, the action you can retry the action you just performed.", TITLE
        );
        return false;
    }
    return true;
};

export const checkForUpdate = async (showUpToDatePopup: boolean = true): Promise<void> => {
    eda.sys_Log.add(`[${TITLE}] Checking for updates...`, ESYS_LogType.INFO);

    try {
        const repoTags = await eda.sys_ClientUrl.request("https://api.github.com/repos/radeeyate/easyeda-wakatime/tags");
        if (repoTags.ok) {
            const tags = await repoTags.json();
            const latestTag = tags[0]?.name;
            if (latestTag && semiver.semiver(latestTag.replace("v", ""), VERSION.replace("v", "")) === 1) { // checking if latest tag is newer than VERSION
                eda.sys_MessageBox.showConfirmationMessage(
                    `A new version of EasyEDA Wakatime is available (${latestTag}). Click okay to open the newest release and update to the latest version for the best experience.`,
                    TITLE,
                    "Okay",
                    undefined,
                    async (mainButtonClicked: boolean): Promise<void> => {
                        if (mainButtonClicked) {
                            eda.sys_Window.open(extensionConfig.repository.url);
                        }
                    }
                );
            } else {
                eda.sys_Log.add(`[${TITLE}] Up to date`, ESYS_LogType.INFO);
                eda.sys_MessageBox.showInformationMessage(`EasyEDA Wakatime is up to date.`, TITLE)
            }
        }
    } catch (error) {
        eda.sys_Log.add(`[${TITLE}] Error checking for updates: ${error}`, ESYS_LogType.ERROR);
        if (showUpToDatePopup) {
            eda.sys_MessageBox.showInformationMessage("Failed to check for updates.", TITLE);
        }
    }
}

export const about = async (): Promise<void> => {
    await eda.sys_IFrame.openIFrame("iframe/about.html", 500, 400)
};

export const setProjDetails = async (): Promise<void> => {
    await eda.sys_IFrame.openIFrame("iframe/edit-project.html", 500, 300);
};

export const setWakatimeSettings = async (): Promise<void> => {
    await eda.sys_IFrame.openIFrame("iframe/edit-settings.html", 500, 400);
};

export const getTodayStats = async (): Promise<void> => {
    if (!await checkApiCredentials()) return;

    try {
        const stats = await eda.sys_ClientUrl.request(
            `${apiURL}/users/current/statusbar/today`,
            "GET",
            undefined,
            {
                headers: {
                    ...COMMON_HEADERS,
                    Authorization: `Bearer ${apiKey}`,
                }
            }
        )

        if (stats.ok) {
            const data = await stats.json();
            const categoryStrings = data.data.categories.map((category: { text: string; name: string; }) => `${category.text} (${category.name})`);
            const joinedStats = `Today's stats: ${categoryStrings.join(", ")}`;
            eda.sys_MessageBox.showInformationMessage(joinedStats, TITLE);
        } else {
            console.error("Error fetching today's stats:", stats.status, await stats.text());
            eda.sys_MessageBox.showInformationMessage(`Error fetching stats: ${stats.status}`, TITLE);
        }
    } catch (error) {
        console.error("Error fetching today's stats:", error);
        eda.sys_MessageBox.showInformationMessage("Failed to fetch today's stats.", TITLE);
    }
}

export const initializeWakatime = async (): Promise<void> => {
    const apiURL = await eda.sys_Storage.getExtensionUserConfig("apiURL");
    const apiKey = await eda.sys_Storage.getExtensionUserConfig("apiKey");

    if (apiURL === undefined || apiKey === undefined) {
        eda.sys_MessageBox.showInformationMessage("Please set your Wakatime API URL and API Key in the settings. You can do this by clicking EasyEDA Wakatime > Settings. After you do that, please enable EasyEDA Wakatime again.", TITLE);
        return;
    }

    await checkForUpdate(false);
    await checkLastPcbEvent();
};

const assembleBody = (projectInfo: { friendlyName: string, editorType: "Schematic" | "PCB" | "Project" | null }) => {
    const projectInfoString = JSON.stringify(projectInfo);
    console.log(projectInfoString);

    const body = [
        {
            // "branch": "master", // version control is coming to easyeda in 2025 (supposedly). we can change this then if it works on a branch system. source: https://oshwlab.com/forum/post/d38b7dd3329e4d23859b6fdfb9a3a97b
            "category": "design",
            "entity": "./" + projectInfo.friendlyName,
            "type": "file",
            "language": `EasyEDA ${projectInfo.editorType}`,
            "project": projectInfo.friendlyName,
            "time": Date.now() / 1000, // to adjust to how wakatime does it
            "user_agent": `easyedapro/${EASYEDA_VERSION} easyeda-wakatime/${VERSION}`
        }
    ];
    return body;
};

const getProjectInfo = async (): Promise<{ friendlyName: string; editorType: "Schematic" | "PCB" | "Project" | null; entity: string } | null> => {
    let name = "";
    let editorType: "Schematic" | "PCB" | "Project" | null = null;
    let entity = "";

    try {
        const projectInfo = await eda.dmt_Project.getCurrentProjectInfo();
        if (projectInfo) {
            name = projectInfo.friendlyName;

            // at this point we can assume that the user is * probably * running a compatible version of easyeda to do the checks, but we still keep the error checks just in case
            const schematicInfo = await eda.dmt_Schematic.getCurrentSchematicInfo();
            if (schematicInfo !== undefined) {
                editorType = "Schematic";
                entity = schematicInfo.name;
            } else {
                const pcbInfo = await eda.dmt_Pcb.getCurrentPcbInfo();
                if (pcbInfo !== undefined) {
                    editorType = "PCB";
                    entity = pcbInfo.name;
                } else {
                    editorType = "Project";
                    entity = projectInfo.friendlyName;
                }
            }
        } else {
            const storedName = await eda.sys_Storage.getExtensionUserConfig("projectName");
            if (storedName === undefined) {
                eda.sys_MessageBox.showInformationMessage("Due to a bug in EasyEDA Pro <=2.2.34.6, we're unable to identify your current project. To temporarily resolve this, you can manually set your project name by clicking EasyEDA Wakatime > Edit Project Details.", TITLE);
                return null;
            }

            name = storedName;
            entity = storedName;
            editorType = "Project";
        }
    } catch (error) {
        const storedName = await eda.sys_Storage.getExtensionUserConfig("projectName");
        if (storedName === undefined) {
            eda.sys_MessageBox.showInformationMessage("Due to a bug in EasyEDA Pro <=2.2.34.6, we're unable to identify your current project. To temporarily resolve this, you can manually set your project name by clicking EasyEDA Wakatime > Edit Project Details.", TITLE);
            return null;
        }

        return { friendlyName: storedName, editorType: "Project", entity: storedName };
    }

    return { friendlyName: name, editorType: editorType, entity: entity }
};


eda.pcb_Event.addMouseEventListener("mouseEvent", "all", async () => { // whilst it's called pcb_event, it detects schematic events as well.
    const now = Date.now();
    await eda.sys_Storage.setExtensionUserConfig(LAST_PCB_EVENT_TIME_KEY, now.toString());
    console.log("Project event occured");
});

const checkLastPcbEvent = async () => {
    while (true) {
        await new Promise(resolve => setTimeout(resolve, HEARTBEAT_INTERVAL));

        const lastEventTimeString = await eda.sys_Storage.getExtensionUserConfig(LAST_PCB_EVENT_TIME_KEY);
        let lastPcbEventTime = 0;
        if (lastEventTimeString !== undefined) {
            lastPcbEventTime = parseInt(lastEventTimeString, 10);
        }

        console.log(lastPcbEventTime, Date.now(), Date.now() - lastPcbEventTime)

        if (lastPcbEventTime) {
            const now = Date.now();
            const timeDiff = now - lastPcbEventTime;

            if (timeDiff <= INACTIVITY_TIMEOUT) {
                console.log("A project event occurred within the last 30 seconds.");

                const projectInfo = await getProjectInfo();
                if (projectInfo) {
                    const body = assembleBody(projectInfo);
                    console.log("Sending heartbeat:", JSON.stringify(body));

                    const apiURL = await eda.sys_Storage.getExtensionUserConfig("apiURL");
                    if (apiURL === undefined) {
                        eda.sys_MessageBox.showInformationMessage("Please set your Wakatime API URL in the settings. You can do this by clicking EasyEDA Wakatime > Settings.", TITLE);
                    }

                    const apiKey = await eda.sys_Storage.getExtensionUserConfig("apiKey");
                    if (apiKey === undefined) {
                        eda.sys_MessageBox.showInformationMessage("Please set your Wakatime API key in the settings. You can do this by clicking EasyEDA Wakatime > Settings.", TITLE);
                    }

                    if (apiKey !== undefined && apiURL !== undefined) {
                        try {
                            const response = await eda.sys_ClientUrl.request(
                                `${apiURL}/heartbeats`,
                                'POST',
                                JSON.stringify(body),
                                {
                                    headers: {
                                        ...COMMON_HEADERS,
                                        Authorization: `Bearer ${apiKey}`,
                                    }
                                }
                            );

                            if (response.ok) {
                                const data = await response.json();
                                console.log("Heartbeat sent successfully:", data);
                                await eda.sys_Log.add(`[${TITLE}] Heartbeat sent successfully`, ESYS_LogType.INFO);
                            } else {
                                await eda.sys_Log.add(`[${TITLE}] Error sending heartbeat: ${response.status} ${await response.text()}`, ESYS_LogType.ERROR);
                            }
                        } catch (err) {
                            await eda.sys_Log.add(`[${TITLE}] Error sending heartbeat: ${err}`, ESYS_LogType.ERROR);
                        }
                    }
                } else {
                    await eda.sys_Log.add(`[${TITLE}] Could not get project info`, ESYS_LogType.WARNING);
                }
            } else {
                console.log("No project events have occurred in the last 30 seconds");
            }
        } else {
            console.log("No project events have occurred yet");
        }
    }
};

activate();