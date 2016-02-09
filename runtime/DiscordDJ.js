var Utils = require('../lib/Logic/Utils.js');
var DiscordDJ = require('../lib/index.js');

var Special = require('./Special.js');

var Discordie = require('discordie');
var fs = require('fs');

if(Discordie == null) {
    console.log('DiscordDJ is not installed correctly.');
    console.log('Please, install it using "setup-bot.bat" or "setup-bot.sh"');
    console.log('http://guichaguri.github.io/DiscordDJ/');
    process.exit(0);
}
var config;
try {
    config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
} catch(e) {
    config = null;
}
var configModified = false;
var connected = false;

var bot = new Discordie();
var manager = null;

function install(shouldLogin, callback) {
    require('./Installer.js')(bot, config, shouldLogin, callback);
    configModified = true;
}

function connect() {
    var credentials = {}, hasCredentials = false;

    if(Utils.exists(config['token'])) {
        credentials['token'] = config['token'];
        hasCredentials = true;
    }
    if(Utils.exists(config['email']) && Utils.exists(config['password'])) {
        credentials['email'] = config['email'];
        credentials['password'] = config['password'];
        hasCredentials = true;
    }

    if(!hasCredentials) return install(true, finishInstallation);

    bot.Dispatcher.removeListener(Discordie.Events.GATEWAY_READY, handleConnection);
    bot.Dispatcher.removeListener(Discordie.Events.DISCONNECTED, handleDisconnection);
    bot.Dispatcher.once(Discordie.Events.GATEWAY_READY, handleConnection);
    bot.Dispatcher.once(Discordie.Events.DISCONNECTED, handleDisconnection);

    console.log('Trying to connect...');
    bot.connect(credentials);
}

function createDJ(djCfg, manager) {

    // Find voice channel

    if(!Utils.exists(djCfg['voice-channel'])) return install(false, finishInstallation);

    var voiceChannel = null;

    if(Utils.exists(djCfg['server'])) {
        var guild = bot.Guilds.get(djCfg['server']) || bot.Guilds.getBy('name', djCfg['server']);
        if(guild != null) {
            voiceChannel = guild.voiceChannels.filter(function(c) {
                return c.name == djCfg['voice-channel'] || c.id == djCfg['voice-channel'];
            });
            voiceChannel = voiceChannel.length == 0 ? null : voiceChannel[0];
        }
    }
    if(voiceChannel == null) {
        voiceChannel = bot.Channels.get(djCfg['voice-channel']) || bot.Channels.getBy('name', djCfg['voice-channel']);
    }

    if(voiceChannel == null) return install(false, finishInstallation);

    if(djCfg['server'] != voiceChannel.guild_id || djCfg['voice-channel'] != voiceChannel.id) {
        configModified = true;
    }
    djCfg['server'] = voiceChannel.guild_id;
    djCfg['voice-channel'] = voiceChannel.id;

    // Prepare config

    if(!Utils.exists(djCfg['rating'])) {
        djCfg['rating'] = {
            'enabled': true,
            'min-votes': 3,
            'min-dislikes': 65
        };
        configModified = true;
    }
    if(!Utils.exists(djCfg['chat-info'])) {
        djCfg['chat-info'] = {
            'now-playing-prefix': '**Now Playing:** ',
            'song-history-channel': null,
            'info-channel': null
        };
        configModified = true;
    }

    if(!Utils.exists(djCfg['mode'])) {
        djCfg['mode'] = {
            'type': 'dj',
            'waitlist': {
                'limit': 50,
                'dj-role': null,
                'list-role': null
            }
        };
        configModified = true;
    } else {
        if(djCfg['mode']['type'] != 'dj' && Utils.exists(djCfg['mode']['waitlist'])) {
            delete djCfg['mode']['waitlist'];
            configModified = true;
        }
    }

    // Find text channels and roles

    var guild = voiceChannel.guild;
    var textCh = guild.textChannels;

    var shCh = djCfg['chat-info']['song-history-channel'];
    shCh = textCh.filter(c => c.id == shCh || c.name == shCh);
    shCh = shCh.length > 0 ? shCh[0] : null;

    var infCh = djCfg['chat-info']['info-channel'];
    infCh = textCh.filter(c => c.id == infCh || c.name == infCh);
    infCh = infCh.length > 0 ? infCh[0] : null;

    if(shCh != null && shCh.id != djCfg['chat-info']['song-history-channel']) {
        djCfg['chat-info']['song-history-channel'] = shCh.id;
        configModified = true;
    }
    if(infCh != null && infCh.id != djCfg['chat-info']['info-channel']) {
        djCfg['chat-info']['info-channel'] = infCh.id;
        configModified = true;
    }

    var mode = null;

    if(djCfg['mode']['type'] == 'dj') {
        var roles = guild.roles;

        var djRole = djCfg['mode']['waitlist']['dj-role'];
        djRole = roles.filter(r => r.id == djRole || r.name == djRole);
        djRole = djRole.length > 0 ? djRole[0] : null;

        var listRole = djCfg['mode']['waitlist']['list-role'];
        listRole = roles.filter(r => r.id == listRole || r.name == listRole);
        listRole = listRole.length > 0 ? listRole[0] : null;

        if(djRole != null && djRole.id == djCfg['mode']['waitlist']['dj-role']) {
            djCfg['mode']['waitlist']['dj-role'] = djRole.id;
            configModified = true;
        }

        if(listRole != null && listRole.id == djCfg['mode']['waitlist']['list-role']) {
            djCfg['mode']['waitlist']['list-role'] = listRole.id;
            configModified = true;
        }

        mode = new DiscordDJ.DJMode({
            'limit': djCfg['mode']['waitlist']['limit'],
            'dj-role': djRole,
            'list-role': listRole
        });
    } else if(djCfg['mode']['type'] == 'playlist') {
        if(!Utils.exists(djCfg['mode']['playlist']) || !Utils.exists(djCfg['mode']['playlist']['type']) ||
            !Utils.exists(djCfg['mode']['playlist']['location'])) {
            djCfg['mode']['playlist'] = {
                type: 'file',
                location: ''
            };
        }
        var playlist = null;
        var loc = djCfg['mode']['playlist']['location'];
        switch(djCfg['mode']['playlist']['type']) {
            case 'file':
                playlist = new DiscordDJ.FilePlaylist(loc);
                break;
            case 'directory':
                playlist = new DiscordDJ.DirectoryPlaylist(loc);
                break;
            case 'youtube':
                playlist = new DiscordDJ.YoutubePlaylist(loc);
                break;
            case 'soundcloud':
                playlist = new DiscordDJ.SoundcloudPlaylist(loc);
                break;
        }
        if(playlist == null) {
            console.log('Unknown playlist type');
        } else {
            mode = new DiscordDJ.PlaylistMode(playlist);
        }
    } else {
        mode = null;
    }

    // Initialize DJ

    console.log('Initializing DJ in "' + voiceChannel.guild.name + '"');
    manager.create(voiceChannel, DiscordDJ.BotDJ).then(function(dj) {

        if(djCfg['rating']['enabled']) {
            dj.enableRating({
                minVotes: djCfg['rating']['min-votes'],
                minDislikes: djCfg['rating']['min-dislikes']
            });
        } else {
            dj.disableRating();
        }

        if(shCh != null || infCh != null) {
            dj.enableInfo({
                nowPlayingPrefix: djCfg['chat-info']['now-playing-prefix'],
                songHistoryChannel: shCh,
                infoChannel: infCh
            });
        } else {
            dj.disableInfo();
        }

        dj.mode = mode;

    }, function(err) {
        console.log('An error occurred with the connection to the voice channel: ' + err);
    });

    return djCfg;
}

function handleConnection() {
    console.log('Connected! Initializing the DJs...');
    connected = true;

    bot.User.setStatus(null, {name: "Music"});

    if(config['token'] != bot.token) configModified = true;
    config['token'] = bot.token;

    if(!Utils.exists(config['djs'])) return install(false, finishInstallation);

    var manager = new DiscordDJ.DJManager(bot);

    for(var i = 0; i < config['djs'].length; i++) {
        config['djs'][i] = createDJ(config['djs'][i], manager);
        if(config['djs'][i] == null) return;
    }

    loadStuff(manager);

    if(configModified) {
        fs.writeFile('config.json', JSON.stringify(config, null, 4), function(error) {
            console.log(error == null ? 'Config saved!' : 'An error ocurred while saving the config: ' + error);
        });
    }
}

function loadStuff(manager) {
    if(!Utils.exists(config['commands'])) {
        config['commands'] = {};
        configModified = true;
    }

    if(manager.handler == null) return;

    config['commands']['prefixes'] = config['commands']['prefixes'] || ['!', '/'];

    config['commands']['prefixes'].forEach(function(prefix) {
        manager.handler.addCommandPrefix(prefix);
    });

    Special.checkUpdate();
    Special.registerCommands(manager.handler);
}

function handleDisconnection() {
    var time;
    if(connected) {
        console.log('The bot has disconnected');
        console.log('Trying to reconnect in 10 seconds...');
        time = 10000;
    } else {
        console.log('Could not connect into the account');
        console.log('Discord is down or the credentials are wrong.');
        console.log('If you want to run the installer again, delete your config file');
        console.log('Trying to reconnect in 30 seconds...');
        time = 30000;
    }
    connected = false;
    setTimeout(connect, time);
}

function finishInstallation(cfg) {
    if(Utils.exists(cfg)) config = cfg;
    handleConnection();
}

if(config == null) {
    config = {};
    install(true, finishInstallation);
} else {
    connect();
}