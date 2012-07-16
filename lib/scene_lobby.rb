#encoding: UTF-8
#==============================================================================
# Scene_Lobby
#------------------------------------------------------------------------------
# 大厅
#==============================================================================

class Scene_Lobby < Scene
  require_relative 'window_userlist'
  require_relative 'window_userinfo'
  require_relative 'window_roomlist'
  require_relative 'window_chat'
  require_relative 'window_host'
  require_relative 'window_lobbybuttons'
  require_relative 'chatmessage'
  require_relative 'scene_duel'
  attr_reader :chat_window
  def start
    WM::set_caption("MyCard v#{Update::Version} - #{$config['game']} - #{$game.user.name}(#{$game.user.id})", "MyCard")
		$game.refresh
		@background = Surface.load("graphics/lobby/background.png").display_format
    Surface.blit(@background,0,0,0,0,$screen,0,0)
		@userlist = Window_UserList.new(24,204,$game.users)
    @roomlist = Window_RoomList.new(320,50,$game.rooms)
		@userinfo = Window_UserInfo.new(24,24, $game.user)
		@host_window = Window_LobbyButtons.new(748,18)
    @active_window = @roomlist
		@chat_window = Window_Chat.new(313,$config['screen']['height'] - 225,698,212)
    @count = 0
    super
  end
  def bgm
    "lobby.ogg"
  end
  def handle(event)
    case event
    when Event::KeyDown
      case event.sym
      when Key::UP
        @active_window.cursor_up
      when Key::DOWN
        @active_window.cursor_down
      when Key::F2
        #@joinroom_msgbox = Widget_Msgbox.new("创建房间", "正在等待对手")
        #$game.host Room.new(0, $game.user.name)        
      when Key::F3
        #@joinroom_msgbox = Widget_Msgbox.new("加入房间", "正在加入房间")
        #$game.join 'localhost'
      when Key::F5
        $game.refresh
      when Key::F12
        $game.exit
        $scene = Scene_Login.new
      end
    else
      super
    end
  end

  def handle_game(event)
    case event
    when Game_Event::AllUsers
      @userlist.items = $game.users
    when Game_Event::AllRooms
      @roomlist.items = $game.rooms
    when Game_Event::Join
      join(event.room)
    when Game_Event::Watch
      require_relative 'scene_watch'
      $scene = Scene_Watch.new(event.room)
    when Game_Event::Chat
      @chat_window.add event.chatmessage
    else
      super
    end
  end
  def join(room)
    $scene = Scene_Duel.new(room)
  end
  def update
    @chat_window.update
    @host_window.update
    @roomlist.update
    if @count >= $game.refresh_interval*60
      $game.refresh
      @count = 0
    end
    @count += 1
    super
  end
  def terminate
    unless $scene.is_a? Scene_Lobby or $scene.is_a? Scene_Duel
      $game.exit
    end
  end
end