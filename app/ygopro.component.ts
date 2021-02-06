/**
 * Created by zh99998 on 16/9/2.
 */
import {
    ChangeDetectorRef,
    Component,
    ElementRef,
    EventEmitter,
    Input,
    OnDestroy,
    OnInit,
    Output,
    ViewChild
} from '@angular/core';
import { Headers, Http } from '@angular/http';
import * as child_process from 'child_process';
import { clipboard, remote, shell } from 'electron';
import * as fs from 'fs-extra';
import * as ini from 'ini';
import { EncodeOptions } from 'ini';
import * as $ from 'jquery';
import * as path from 'path';
import 'rxjs/Rx';
import { ISubscription } from 'rxjs/Subscription';
import { App } from './app';
import { AppsService } from './apps.service';
import { LoginService } from './login.service';
import { SettingsService } from './settings.sevices';
import Timer = NodeJS.Timer;
import WillNavigateEvent = Electron.WillNavigateEvent;

interface SystemConf {
    use_d3d: string;
    antialias: string;
    errorlog: string;
    nickname: string;
    gamename: string;
    lastdeck: string;
    textfont: string;
    numfont: string;
    serverport: string;
    lastip: string;
    lasthost: string;
    lastport: string;
    autopos: string;
    randompos: string;
    autochain: string;
    waitchain: string;
    mute_opponent: string;
    mute_spectators: string;
    hide_setname: string;
    hide_hint_button: string;
    control_mode: string;
    draw_field_spell: string;
    separate_clear_button: string;
    roompass: string;
}

interface Server {
    id?: string;
    url?: string;
    address: string;
    port: number;
    custom?: boolean;
    replay?: boolean;
}

interface Room {
    id?: string;
    title?: string;
    server?: Server;
    'private'?: boolean;
    options: Options;
    arena?: string;
    users?: { username: string, position: number }[];
}

interface Options {
    mode: number;
    rule: number;
    start_lp: number;
    start_hand: number;
    draw_count: number;
    enable_priority: boolean;
    no_check_deck: boolean;
    no_shuffle_deck: boolean;
    lflist?: number;
    time_limit?: number;
}
export interface Points {
    exp: number;
    exp_rank: number;
    pt: number;
    arena_rank: number;
    win: number;
    lose: number;
    draw: number;
    all: number;
    ratio: number;
}

interface YGOProData {
    windbot: { [locale: string]: string[] };
}


let matching: ISubscription | undefined;
let matching_arena: string | undefined;
let match_started_at: Date;

@Component({
    moduleId: module.id,
    selector: 'ygopro',
    templateUrl: 'ygopro.component.html',
    styleUrls: ['ygopro.component.css'],
})
export class YGOProComponent implements OnInit, OnDestroy {
    @Input()
    app: App;
    @Input()
    currentApp: App;

    @Output()
    points: EventEmitter<Points> = new EventEmitter();
    decks: string[] = [];
    replays: string[] = [];
    current_deck: string;
    system_conf: string;
    numfont: string[];
    textfont: string[];

    @ViewChild('bilibili')
    bilibili: ElementRef;

    @ViewChild('youtube')
    youtube: ElementRef;
    // points: Points;

    windbot: string[]; // ["琪露诺", "谜之剑士LV4", "复制植物", "尼亚"];

    servers: Server[] = [];

    rooms_loading = true;

    default_options: Options = {
        mode: 1,
        rule: this.settingsService.getLocale().startsWith('zh') ? 0 : 1,
        start_lp: 8000,
        start_hand: 5,
        draw_count: 1,
        enable_priority: false,
        no_check_deck: false,
        no_shuffle_deck: false,
        lflist: 0,
        time_limit: 180
    };

    room: Room = { title: this.loginService.user.username + '的房间', options: Object.assign({}, this.default_options) };

    rooms: Room[] = [];

    connections: WebSocket[] = [];
    replay_connections: WebSocket[] = [];
    replay_rooms: Room[] = [];
    replay_rooms_show: Room[];
    replay_rooms_filter = {
        athletic: true,
        entertain: true,
        single: true,
        match: true,
        tag: true,
        windbot: false
    };

    matching: ISubscription | undefined;
    matching_arena: string | undefined;
    match_time: string;
    match_cancelable: boolean;
    match_interval: Timer | undefined;

    join_password: string;
    host_password = (this.loginService.user.external_id ^ 0x54321).toString();

    constructor(private http: Http, private appsService: AppsService, private loginService: LoginService,
                public settingsService: SettingsService, private ref: ChangeDetectorRef) {
        switch (process.platform) {
            case 'darwin':
                this.numfont = ['/System/Library/Fonts/SFNSTextCondensed-Bold.otf','/System/Library/Fonts/Supplemental/Arial.ttf'];
                this.textfont = ['/System/Library/Fonts/PingFang.ttc'];
                break;
            case 'win32':
                this.numfont = [path.join(process.env['SystemRoot']!, 'Fonts', 'arialbd.ttf')];
                this.textfont = [
                    path.join(process.env['SystemRoot']!, 'Fonts', 'msyh.ttc'),
                    path.join(process.env['SystemRoot']!, 'Fonts', 'msyh.ttf'),
                    path.join(process.env['SystemRoot']!, 'Fonts', 'simsun.ttc')
                ];
                break;
        }

        if (matching) {
            this.matching = matching;
            this.matching_arena = matching_arena;
            this.refresh_match();
            this.match_interval = setInterval(() => {
                this.refresh_match();
            }, 1000);
        }

        if (this.settingsService.getLocale().startsWith('zh')) {
            this.servers.push({
                id: 'tiramisu',
                url: 'wss://tiramisu.mycard.moe:7923',
                address: 'tiramisu.mycard.moe',
                port: 7911,
                custom: true,
                replay: true
            }, {
                id: 'tiramisu-athletic',
                url: 'wss://tiramisu.mycard.moe:8923',
                address: 'tiramisu.mycard.moe',
                port: 8911,
                custom: false,
                replay: true
            });
        } else {
            this.servers.push({
                id: 'mercury-us-1-athletic',
                url: 'wss://mercury-us-1.mycard.moe:7923',
                address: 'mercury-us-1.mycard.moe',
                port: 7911,
                custom: true,
                replay: true
            }, {
                id: 'mercury-us-1',
                url: 'wss://mercury-us-1.mycard.moe:7923',
                address: 'mercury-us-1.mycard.moe',
                port: 8911,
                custom: false,
                replay: true
            });
        }

    }

    refresh_replay_rooms() {
        this.replay_rooms_show = this.replay_rooms.filter((room) => {
            return ((this.replay_rooms_filter.athletic && room.arena === 'athletic') ||
            (this.replay_rooms_filter.entertain && room.arena === 'entertain') ||
            (this.replay_rooms_filter.single && room.options.mode === 0 && !room.arena && !room.id!.startsWith('AI#')) ||
            (this.replay_rooms_filter.match && room.options.mode === 1 && !room.arena && !room.id!.startsWith('AI#')) ||
            (this.replay_rooms_filter.tag && room.options.mode === 2 && !room.arena && !room.id!.startsWith('AI#')) ||
            (this.replay_rooms_filter.windbot && room.id!.startsWith('AI#')));
        }).sort((a, b) => {
            // if (a.arena === 'athletic' && b.arena === 'athletic') {
            //     return a.dp - b.dp;
            // } else if (a.arena === 'entertain' && b.arena === 'entertain') {
            //     return a.exp - b.exp;
            // }
            let [a_priority, b_priority] = [a, b].map((room) => {
                if (room.arena === 'athletic') {
                    return 0;
                } else if (room.arena === 'entertain') {
                    return 1;
                } else if (room.id!.startsWith('AI#')) {
                    return 5;
                } else {
                    return room.options.mode + 2;
                }
            });
            return a_priority - b_priority;
        });
    }

    async ngOnInit() {

        let locale: string;
        if (this.settingsService.getLocale().startsWith('zh')) {
            locale = 'zh-CN';
        } else {
            locale = 'en-US';
        }
        this.windbot = (<YGOProData>this.app.data).windbot[locale];

        this.system_conf = path.join(this.app.local!.path, 'system.conf');
        await this.refresh();

        let modal = $('#game-list-modal');

        modal.on('show.bs.modal', () => {
            this.rooms_loading = true;
            this.connections = this.servers.filter(server => server.custom).map((server) => {
                let url = new URL(server.url!);
                url['searchParams'].set('filter', 'waiting');
                let connection = new WebSocket(url.toString());
                connection.onclose = (event: CloseEvent) => {
                    this.rooms = this.rooms.filter(room => room.server !== server);
                };
                connection.onerror = (event: ErrorEvent) => {
                    console.log('error', server.id, event);
                    this.rooms = this.rooms.filter(room => room.server !== server);
                };
                connection.onmessage = (event) => {
                    let message = JSON.parse(event.data);
                    switch (message.event) {
                        case 'init':
                            this.rooms_loading = false;
                            this.rooms = this.rooms.filter(room => room.server !== server).concat(
                                message.data.map((room: Room) => Object.assign({ server: server }, room))
                            );
                            break;
                        case 'create':
                            this.rooms.push(Object.assign({ server: server }, message.data));
                            break;
                        case 'update':
                            Object.assign(this.rooms.find(room => room.server === server && room.id === message.data.id), message.data);
                            break;
                        case 'delete':
                            this.rooms.splice(this.rooms.findIndex(room => room.server === server && room.id === message.data), 1);
                    }
                    this.ref.detectChanges();
                };
                return connection;
            });
        });

        modal.on('hide.bs.modal', () => {
            for (let connection of this.connections) {
                connection.close();
            }
            this.connections = [];
        });

        // TODO: 跟上面的逻辑合并
        let replay_modal = $('#game-replay-modal');

        replay_modal.on('show.bs.modal', () => {
            this.replay_connections = this.servers.filter(server => server.replay).map((server) => {
                let url = new URL(server.url!);
                url['searchParams'].set('filter', 'started');
                let connection = new WebSocket(url.toString());
                connection.onclose = () => {
                    this.replay_rooms = this.replay_rooms.filter(room => room.server !== server);
                    this.refresh_replay_rooms();
                };
                connection.onmessage = (event) => {
                    let message = JSON.parse(event.data);
                    switch (message.event) {
                        case 'init':
                            this.replay_rooms = this.replay_rooms.filter(room => room.server !== server).concat(
                                message.data.map((room: Room) => Object.assign({
                                    server: server,
                                    'private': /^\d+$/.test(room.title!)
                                }, room))
                            );
                            break;
                        case 'create':
                            this.replay_rooms.push(Object.assign({
                                server: server,
                                'private': /^\d+$/.test(message.data.title!)
                            }, message.data));
                            break;
                        case 'delete':
                            this.replay_rooms.splice(
                                this.replay_rooms.findIndex(room => room.server === server && room.id === message.data),
                                1
                            );
                    }
                    this.refresh_replay_rooms();
                    this.ref.detectChanges();
                };
                return connection;
            });
        });

        replay_modal.on('hide.bs.modal', () => {
            for (let connection of this.replay_connections) {
                connection.close();
            }
            this.replay_connections = [];
        });

        remote.ipcMain.on('YGOPro', (e: any, type: string) => {
            console.log('rrrrr');
            this.request_match(type);
        });
    }


    async refresh() {
        this.decks = await this.get_decks();
        let system_conf = await this.load_system_conf();

        if (this.decks.includes(system_conf.lastdeck)) {
            this.current_deck = system_conf.lastdeck;
        } else {
            this.current_deck = this.decks[0];
        }

        this.replays = await this.get_replays();

        // https://mycard.moe/ygopro/api/user?username=ozxdno
        try {
            let points = await this.http.get('https://mycard.moe/ygopro/api/user', {
                search: {
                    username: this.loginService.user.username
                }
            })
                .map((response) => response.json())
                .toPromise();
            this.points.emit(points);
        } catch (error) {
            console.log(error);
        }
    };

    async get_decks(): Promise<string[]> {
        try {
            let files: string[] = await fs.readdir(path.join(this.app.local!.path, 'deck'));
            return files.filter(file => path.extname(file) === '.ydk').map(file => path.basename(file, '.ydk'));
        } catch (error) {
            return [];
        }
    }

    async get_replays(): Promise<string[]> {
        try {
            let files: string[] = await fs.readdir(path.join(this.app.local!.path, 'replay'));
            return files.filter(file => path.extname(file) === '.yrp').map(file => path.basename(file, '.yrp'));
        } catch (error) {
            return [];
        }
    }

    async get_font(files: string[]): Promise<string | undefined> {
        for (let file of files) {
            if (await fs.pathExists(file)) {
                return file;
            }
        }
    }

    async delete_deck(deck: string) {
        if (confirm('确认删除?')) {
            try {
                await fs.unlink(path.join(this.app.local!.path, 'deck', deck + '.ydk'));
            } catch (error) {
            }
            return this.refresh();
        }
    }

    async fix_fonts(data: SystemConf) {
        if (!await this.get_font([data.numfont])) {
            let font = await this.get_font(this.numfont);
            if (font) {
                data['numfont'] = font;
            }
        }

        if (data.textfont === 'c:/windows/fonts/simsun.ttc 14' || !await this.get_font([data.textfont.split(' ', 2)[0]])) {
            let font = await this.get_font(this.textfont);
            if (font) {
                data['textfont'] = `${font} 14`;
            }
        }
    };

    async load_system_conf(): Promise<SystemConf> {
        let data = await fs.readFile(this.system_conf, { encoding: 'utf-8' });
        return <any>ini.parse(data);
    };

    save_system_conf(data: SystemConf) {
        return fs.writeFile(this.system_conf, ini.unsafe(ini.stringify(data, <EncodeOptions>{ whitespace: true })));
    };

    async join(name: string, server: Server) {
        let system_conf = await this.load_system_conf();
        await this.fix_fonts(system_conf);
        system_conf.lastdeck = this.current_deck;
        system_conf.lastip = server.address;
        system_conf.lasthost = server.address;
        system_conf.lastport = server.port.toString();
        system_conf.roompass = name;
        system_conf.nickname = this.loginService.user.username;
        await this.save_system_conf(system_conf);
        return this.start_game(['-j']);
    };

    async edit_deck(deck: string) {
        let system_conf = await this.load_system_conf();
        await this.fix_fonts(system_conf);
        system_conf.lastdeck = deck;
        await this.save_system_conf(system_conf);
        return this.start_game(['-d', deck]);
    }

    async watch_replay(replay: string) {
        let system_conf = await this.load_system_conf();
        await this.fix_fonts(system_conf);
        await this.save_system_conf(system_conf);
        return this.start_game(['-r', path.join('replay', replay + '.yrp')]);
    }

    join_windbot(name?: string) {
        if (!name) {
            name = this.windbot[Math.floor(Math.random() * this.windbot.length)];
        }
        return this.join('AI#' + name, this.servers[0]);
    }

    async start_game(args: string[]) {
        let data: any;
        let start_time: string;
        let exp_rank_ex: number;
        let arena_rank_ex: number;
        let win = remote.getCurrentWindow();

        win.minimize();
        await new Promise((resolve, reject) => {
            let child = child_process.spawn(path.join(this.app.local!.path, this.app.actions.get('main')!.execute), args, {
                cwd: this.app.local!.path,
                stdio: 'inherit'
            });
            child.on('error', (error) => {
                reject(error);
                win.restore();
            });
            child.on('exit', async (code, signal) => {
                // error 触发之后还可能会触发exit，但是Promise只承认首次状态转移，因此这里无需重复判断是否已经error过。
                await this.refresh();
                resolve();
                win.restore();
            });
            try {
                this.http.get('https://mycard.moe/ygopro/api/history', {
                    search: {
                        page: 1,
                        username: this.loginService.user.username,
                        type: 0,
                        page_num: 1
                    }
                })
                    .map((response) => response.json())
                    .toPromise()
                    .then((d) => {
                        start_time = d.data[0].start_time;
                    });
            } catch (error) {
                console.log(error);
            }
            try {
                this.http.get('https://api.mycard.moe/ygopro/arena/user', { search: { username: this.loginService.user.username } })
                    .map((response) => response.json())
                    .toPromise()
                    .then((d2) => {
                        exp_rank_ex = d2.exp_rank;
                        arena_rank_ex = d2.arena_rank;
                    });
            } catch (error) {
                console.log(error);
            }
        });
        try {
            await this.http.get('https://mycard.moe/ygopro/api/history', {
                search: {
                    page: 1,
                    username: this.loginService.user.username,
                    // username: "星光pokeboy",
                    type: 0,
                    page_num: 1
                }
            })
                .map((response) => response.json())
                .toPromise()
                .then((d) => {
                    data = d.data[0];
                    data.myname = this.loginService.user.username;
                });

            await this.http.get('https://api.mycard.moe/ygopro/arena/user', {
                search: {
                    username: this.loginService.user.username,
                }
            })
                .map((response) => response.json())
                .toPromise()
                .then((data2) => {
                    data.athletic_win = data2.athletic_win;
                    data.athletic_lose = data2.athletic_lose;
                    data.entertain_win = data2.entertain_win;
                    data.entertain_lose = data2.entertain_lose;
                    data.exp_rank = data2.exp_rank;
                    data.arena_rank = data2.arena_rank;
                    data.exp_rank_ex = exp_rank_ex;
                    data.arena_rank_ex = arena_rank_ex;
                    if (start_time !== data.start_time) {
                        this.appsService.showResult('end_YGOPro_single.html', data, 202, 222);
                    }
                });
        } catch (error) {
            console.log(error);
        }
    };

    create_room(room: Room) {
        let options_buffer = new Buffer(6);
        // 建主密码 https://docs.google.com/document/d/1rvrCGIONua2KeRaYNjKBLqyG9uybs9ZI-AmzZKNftOI/edit
        options_buffer.writeUInt8((room.private ? 2 : 1) << 4, 1);
        options_buffer.writeUInt8(
            room.options.rule << 5 |
            room.options.mode << 3 |
            (room.options.enable_priority ? 1 << 2 : 0) |
            (room.options.no_check_deck ? 1 << 1 : 0) |
            (room.options.no_shuffle_deck ? 1 : 0)
            , 2);
        options_buffer.writeUInt16LE(room.options.start_lp, 3);
        options_buffer.writeUInt8(room.options.start_hand << 4 | room.options.draw_count, 5);
        let checksum = 0;
        for (let i = 1; i < options_buffer.length; i++) {
            checksum -= options_buffer.readUInt8(i);
        }
        options_buffer.writeUInt8(checksum & 0xFF, 0);

        let secret = this.loginService.user.external_id % 65535 + 1;
        for (let i = 0; i < options_buffer.length; i += 2) {
            options_buffer.writeUInt16LE(options_buffer.readUInt16LE(i) ^ secret, i);
        }

        let password = options_buffer.toString('base64') + (room.private ? this.host_password :
                room.title!.replace(/\s/, String.fromCharCode(0xFEFF)));
        // let room_id = crypto.createHash('md5').update(password + this.loginService.user.username).digest('base64')
        //     .slice(0, 10).replace('+', '-').replace('/', '_');

        if (room.private) {
            new Notification('YGOPro 私密房间已建立', {
                body: `房间密码是 ${this.host_password}, 您的对手可在自定义游戏界面输入密码与您对战。`
            });
        }
        this.join(password, this.servers[0]);
    }

    copy(text: string, event: Event) {
        clipboard.writeText(text);
        $('#copy-wrapper').tooltip({ trigger: 'manual' }).tooltip('show');
    }

    join_room(room: Room) {
        let options_buffer = new Buffer(6);
        options_buffer.writeUInt8(3 << 4, 1);
        let checksum = 0;
        for (let i = 1; i < options_buffer.length; i++) {
            checksum -= options_buffer.readUInt8(i);
        }
        options_buffer.writeUInt8(checksum & 0xFF, 0);

        let secret = this.loginService.user.external_id % 65535 + 1;
        for (let i = 0; i < options_buffer.length; i += 2) {
            options_buffer.writeUInt16LE(options_buffer.readUInt16LE(i) ^ secret, i);
        }


        let name = options_buffer.toString('base64') + room.id;

        this.join(name, room.server!);
    }

    join_private(password: string) {
        let options_buffer = new Buffer(6);
        options_buffer.writeUInt8(5 << 4, 1);
        let checksum = 0;
        for (let i = 1; i < options_buffer.length; i++) {
            checksum -= options_buffer.readUInt8(i);
        }
        options_buffer.writeUInt8(checksum & 0xFF, 0);

        let secret = this.loginService.user.external_id % 65535 + 1;
        for (let i = 0; i < options_buffer.length; i += 2) {
            options_buffer.writeUInt16LE(options_buffer.readUInt16LE(i) ^ secret, i);
        }

        let name = options_buffer.toString('base64') + password.replace(/\s/, String.fromCharCode(0xFEFF));

        this.join(name, this.servers[0]);
    }

    request_match(arena = 'entertain') {
        let headers = new Headers();
        headers.append('Authorization',
            'Basic ' + Buffer.from(this.loginService.user.username + ':' + this.loginService.user.external_id).toString('base64'));
        match_started_at = new Date();
        this.matching_arena = matching_arena = arena;
        this.matching = matching = this.http.post('https://api.mycard.moe/ygopro/match', null, {
            headers: headers,
            search: {
                arena,
                locale: this.settingsService.getLocale()
            }
        }).map(response => response.json())
            .subscribe((data) => {
                this.join(data['password'], { address: data['address'], port: data['port'] });
            }, (error) => {
                alert(`匹配失败`);
                this.matching = matching = undefined;
                this.matching_arena = matching_arena = undefined;
                if (this.match_interval) {
                    clearInterval(this.match_interval);
                    this.match_interval = undefined;
                }
            }, () => {
                this.matching = matching = undefined;
                this.matching_arena = matching_arena = undefined;
                if (this.match_interval) {
                    clearInterval(this.match_interval);
                    this.match_interval = undefined;
                }
            });

        this.refresh_match();
        this.match_interval = setInterval(() => {
            this.refresh_match();
        }, 1000);
    }

    cancel_match() {
        this.matching!.unsubscribe();
        this.matching = matching = undefined;
        this.matching_arena = matching_arena = undefined;
        if (this.match_interval) {
            clearInterval(this.match_interval);
            this.match_interval = undefined;
        }
    }

    ngOnDestroy() {
        if (this.match_interval) {
            clearInterval(this.match_interval);
            this.match_interval = undefined;
        }

        remote.ipcMain.removeAllListeners('YGOPro');
    }

    refresh_match() {
        let match_time = Math.floor((new Date().getTime() - match_started_at.getTime()) / 1000);
        let minute = Math.floor(match_time / 60).toString();
        if (minute.length === 1) {
            minute = '0' + minute;
        }
        let second = (match_time % 60).toString();
        if (second.length === 1) {
            second = '0' + second;
        }
        this.match_time = `${minute}:${second}`;
        this.match_cancelable = match_time <= 5 || match_time >= 180;
    }

    bilibili_loaded() {
        this.bilibili.nativeElement.insertCSS(`
            #b_app_link {
                visibility: hidden;
            }
            .wrapper {
                padding-top: 0 !important;
                overflow-y: hidden;
            }
            .nav-bar, .top-title, .roll-bar, footer {
                display: none !important;
            }
            html, body {
                background-color: initial !important;
            }
        `);
    }

    bilibili_navigate(event: WillNavigateEvent) {
        // event.preventDefault();
        // https://github.com/electron/electron/issues/1378
        this.bilibili.nativeElement.src = 'http://m.bilibili.com/search.html?keyword=YGOPro';
        shell.openExternal(event.url);
    }

    // youtube_loaded () {
    //
    // }
    //
    // youtube_navigate (event: WillNavigateEvent) {
    //     this.youtube.nativeElement.src = 'https://m.youtube.com/results?search_query=YGOPro';
    //     shell.openExternal(event.url);
    // }
}
