import React from 'react';
import {
  SessionRecordingStatus,
  getStatusText,
  CallingState,
  ConnectionStatus,
  RemoteControlStatus,
} from 'Player';

/**
 * `SessionConfirmStatus` was imported from 'Player' but is not defined or exported
 * anywhere in the codebase, which breaks the production build. The `sessionConfirmation`
 * state it is compared against is likewise never set by anything (this file is its only
 * reference), so both branches below are permanently false.
 *
 * Declared locally to restore a buildable tree while preserving the exact runtime
 * behaviour (an undefined state never equals any member). Remove this, along with the
 * dead branches, if the session-confirmation flow is finished or dropped upstream.
 */
enum SessionConfirmStatus {
  Disabled,
  Requesting,
  Enabled,
}

import Loader from 'Components/Session_/Player/Overlay/Loader';
import RequestingWindow, {
  WindowType,
} from 'App/components/Assist/RequestingWindow';
import {
  PlayerContext,
  ILivePlayerContext,
} from 'App/components/Session/playerContext';
import { observer } from 'mobx-react-lite';
import LiveStatusText from './LiveStatusText';

interface Props {
  closedLive?: boolean;
}

function Overlay({ closedLive }: Props) {
  // @ts-ignore ?? TODO
  const { store } = React.useContext<ILivePlayerContext>(PlayerContext);

  const {
    messagesLoading,
    peerConnectionStatus,
    livePlay,
    calling,
    remoteControl,
    recordingState,
    sessionConfirmation,
    tabStates,
    currentTab,
  } = store.get();

  const cssLoading = tabStates[currentTab]?.cssLoading || false;
  const loading = messagesLoading || cssLoading;
  const liveStatusText = getStatusText(peerConnectionStatus);
  const connectionStatus = peerConnectionStatus;

  const showLiveStatusText = livePlay && liveStatusText && !loading;

  const showRequestWindow =
    sessionConfirmation === SessionConfirmStatus.Requesting ||
    calling === CallingState.Connecting ||
    remoteControl === RemoteControlStatus.Requesting ||
    recordingState === SessionRecordingStatus.Requesting;

  const getRequestWindowType = () => {
    if (sessionConfirmation === SessionConfirmStatus.Requesting) {
      return WindowType.SessionConfirm;
    }
    if (calling === CallingState.Connecting) {
      return WindowType.Call;
    }
    if (remoteControl === RemoteControlStatus.Requesting) {
      return WindowType.Control;
    }
    if (recordingState === SessionRecordingStatus.Requesting) {
      return WindowType.Record;
    }

    return null;
  };

  return (
    <>
      {/* @ts-ignore wtf */}
      {showRequestWindow ? (
        <RequestingWindow getWindowType={getRequestWindowType} />
      ) : null}
      {showLiveStatusText && (
        <LiveStatusText
          connectionStatus={
            closedLive ? ConnectionStatus.Closed : connectionStatus
          }
        />
      )}
      {loading ? <Loader /> : null}
    </>
  );
}

export default observer(Overlay);
