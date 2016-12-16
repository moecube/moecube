import {Component, OnInit, Input, ChangeDetectorRef} from "@angular/core";
import {AppsService} from "./apps.service";
import {InstallOption} from "./install-option";
import {SettingsService} from "./settings.sevices";
import {App} from "./app";
import {DownloadService} from "./download.service";
import {clipboard, remote} from "electron";
import * as path from "path";
import * as fs from "fs";

declare const Notification: any;
declare const $: any;

@Component({
    moduleId: module.id,
    selector: 'app-detail',
    templateUrl: 'app-detail.component.html',
    styleUrls: ['app-detail.component.css'],
})
export class AppDetailComponent implements OnInit {
    @Input()
    currentApp: App;
    platform = process.platform;

    installOption: InstallOption;
    availableLibraries: string[] = [];
    references: App[];
    referencesInstall: {[id: string]: boolean};

    import_path: string;

    constructor(private appsService: AppsService, private settingsService: SettingsService,
                private  downloadService: DownloadService, private ref: ChangeDetectorRef) {
    }

    async ngOnInit(): Promise<void> {
        let volume = 'A';
        for (let i = 0; i < 26; i++) {
            await new Promise((resolve, reject) => {
                let currentVolume = String.fromCharCode(volume.charCodeAt(0) + i) + ":";
                fs.access(currentVolume, (err) => {
                    if (!err) {
                        //判断是否已经存在Library
                        if (this.libraries.every((library) => !library.startsWith(currentVolume))) {
                            this.availableLibraries.push(currentVolume);
                        }
                    }
                    resolve()
                })
            })
        }
    }

    updateInstallOption(app: App) {
        this.installOption = new InstallOption(app);
        this.installOption.installLibrary = this.settingsService.getDefaultLibrary().path;
        this.references = Array.from(app.references.values());
        console.log(this.references);
        this.referencesInstall = {};
        for (let reference of this.references) {
            if (reference.isLanguage()) {
                // 对于语言包，只有在语言包的locales比游戏本身的更加合适的时候才默认勾选
                // 这里先偷个懒，中文环境勾选中文语言包，非中文环境勾选非中文语言包
                this.referencesInstall[reference.id] = reference.locales[0].startsWith('zh') == this.settingsService.getLocale().startsWith('zh')
            } else {
                this.referencesInstall[reference.id] = true;
            }
        }
    }

    get libraries(): string[] {
        return this.settingsService.getLibraries().map((item) => item.path);
    }

    get news() {
        return this.currentApp.news;
    }

    get mods(): App[] {
        return this.appsService.findChildren(this.currentApp);
    }

    async installMod(mod: App) {

        let option = new InstallOption(mod, path.dirname(mod.parent!.local!.path));
        await this.install(mod, option, {});

    }

    async uninstall(app: App) {
        if (confirm("确认删除？")) {
            try {
                await this.appsService.uninstall(app);
            } catch (e) {
                alert(e);
            }
        }
    }

    async install(targetApp: App, options: InstallOption, referencesInstall: {[id: string]: boolean}) {
        $('#install-modal').modal('hide');

        try {
            await this.appsService.install(targetApp, options);
            for (let [id, install] of Object.entries(referencesInstall)) {
                if (install) {
                    let reference = targetApp.references.get(id)!;
                    console.log("reference install ", id, targetApp, targetApp.references, reference);
                    await this.appsService.install(reference, options);
                }
            }
        } catch (e) {
            console.error(e);
            new Notification(targetApp.name, {body: "下载失败"});
        }
    }

    async selectLibrary() {
        if (this.installOption.installLibrary.startsWith('create_')) {
            let volume = this.installOption.installLibrary.slice(7);
            let library = path.join(volume, "MyCardLibrary");
            try {
                await this.appsService.createDirectory(library);
                this.installOption.installLibrary = library;
                this.settingsService.addLibrary(library, true);
            } catch (e) {
                this.installOption.installLibrary = this.settingsService.getDefaultLibrary().path;
                alert("无法创建指定目录");
            } finally {
                let index = this.availableLibraries.findIndex((l) => {
                    return l === volume
                });
                this.availableLibraries.splice(index, 1);
            }
        } else {
            this.settingsService.setDefaultLibrary({path: this.installOption.installLibrary, "default": true})
        }
        this.installOption.installLibrary = this.settingsService.getDefaultLibrary().path;
    }

    selectDir() {
        let dir = remote.dialog.showOpenDialog({properties: ['openFile', 'openDirectory']});
        console.log(dir);
        // this.appsService.installOption.installDir = dir[0];
        return dir[0];
    }

    runApp(app: App) {
        this.appsService.runApp(app);
    }

    custom(app: App) {
        this.appsService.runApp(app, 'custom');
    }

    async importGame(targetApp: App, option: InstallOption, referencesInstall: {[id: string]: boolean}) {
        $('#import-modal').modal('hide');
        let dir = path.dirname(this.import_path);
        // TODO: 执行依赖和references安装
        try {
            await this.appsService.importApp(targetApp, dir, option);
            for (let [id, install] of Object.entries(referencesInstall)) {
                if (install) {
                    let reference = targetApp.references.get(id)!;
                    console.log("reference install ", id, targetApp, targetApp.references, reference);
                    await this.appsService.install(reference, option);
                }
            }
        } catch (e) {
            console.error(e);
            new Notification(targetApp.name, {body: "导入失败"});
        }
    }

    async verifyFiles(app: App) {
        try {
            await this.appsService.update(app, true);
            let installedMods = this.appsService.findChildren(app).filter((child) => {
                return child.parent === app && child.isInstalled() && child.isReady();
            });
            for (let mod of installedMods) {
                await this.appsService.update(mod, true);
            }
        } catch (e) {
            new Notification(app.name, {body: "校验失败"});
            console.error(e);
        }
    }

    copy(text: string) {
        clipboard.writeText(text);
    }

    async selectImport(app: App) {
        let main = app.actions.get('main');
        if (!main) {
            return
        }
        if (!main.execute) {
            return
        }
        let filename = main.execute.split('/')[0];
        let extname = path.extname(filename).slice(1);

        // let remote = require('electron').remote
        let filePaths = await new Promise((resolve, reject) => {
            remote.dialog.showOpenDialog({
                filters: [{name: filename, extensions: [extname]}],
                properties: ['openFile',]
            }, resolve)
        });

        if (filePaths && filePaths[0]) {
            this.import_path = filePaths[0]
        }

    }
}
