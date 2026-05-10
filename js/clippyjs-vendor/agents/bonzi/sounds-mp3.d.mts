declare namespace agent_d_exports {
  export { _default$1 as default };
}
declare const _default$1: {
  overlayCount: number;
  sounds: string[];
  framesize: number[];
  animations: {
    MoveLeft: {
      frames: ({
        duration: number;
        images: number[][];
        sound?: undefined;
      } | {
        duration: number;
        images: number[][];
        sound: string;
      })[];
    };
    Congratulate: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
        sound?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        sound: string;
      } | {
        duration: number;
        images: number[][];
        exitBranch?: undefined;
        sound?: undefined;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
        sound?: undefined;
      })[];
    };
    Hide: {
      frames: ({
        duration: number;
        images: number[][];
        sound?: undefined;
      } | {
        duration: number;
        images: number[][];
        sound: string;
      })[];
    };
    Acknowledge: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    Suggest: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    Explain: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
      })[];
      useExitBranching: boolean;
    };
    Decline: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    DontRecognize: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    Writing: {
      frames: {
        duration: number;
        images: number[][];
        exitBranch: number;
      }[];
    };
    Idle3_3: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    Idle3_2: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    Idle3_1: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    ReadReturn: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    StartListening: {
      frames: {
        duration: number;
        images: number[][];
        exitBranch: number;
      }[];
    };
    Idle2_2: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    Announce: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    GetAttention: {
      frames: ({
        duration: number;
        images: number[][];
        sound?: undefined;
      } | {
        duration: number;
        images: number[][];
        sound: string;
      })[];
    };
    Idle2_1: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
        branching?: undefined;
      })[];
      useExitBranching: boolean;
    };
    GestureLeft: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
      })[];
      useExitBranching: boolean;
    };
    Surprised: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    Idle1_5: {
      frames: ({
        duration: number;
        images: number[][];
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
      })[];
    };
    Idle1_4: {
      frames: ({
        duration: number;
        images: number[][];
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
      })[];
    };
    LookRight: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
        branching?: undefined;
      })[];
      useExitBranching: boolean;
    };
    GestureUp: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
      })[];
      useExitBranching: boolean;
    };
    Idle1_1: {
      frames: ({
        duration: number;
        images: number[][];
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
      })[];
    };
    Idle1_3: {
      frames: ({
        duration: number;
        images: number[][];
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
      })[];
    };
    Idle1_2: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    Read: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    Processing: {
      frames: {
        duration: number;
        images: number[][];
        exitBranch: number;
      }[];
    };
    Alert: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
      })[];
    };
    DoMagic1: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    DoMagic2: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    Confused: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
      })[];
      useExitBranching: boolean;
    };
    GetAttention2: {
      frames: ({
        duration: number;
        images: number[][];
        sound: string;
      } | {
        duration: number;
        images: number[][];
        sound?: undefined;
      })[];
    };
    MoveRight: {
      frames: ({
        duration: number;
        images: number[][];
        sound?: undefined;
      } | {
        duration: number;
        images: number[][];
        sound: string;
      })[];
    };
    Reading: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    LookUp: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
        branching?: undefined;
      })[];
      useExitBranching: boolean;
    };
    GetAttentionContinued: {
      frames: {
        duration: number;
        images: number[][];
        exitBranch: number;
      }[];
    };
    WriteContinued: {
      frames: {
        duration: number;
        images: number[][];
        exitBranch: number;
      }[];
    };
    Search: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
      })[];
      useExitBranching: boolean;
    };
    Uncertain: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
        branching?: undefined;
      })[];
      useExitBranching: boolean;
    };
    LookLeft: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
        branching?: undefined;
      })[];
      useExitBranching: boolean;
    };
    LookDownReturn: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    LookUpReturn: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    LookLeftReturn: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    Greet: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
      })[];
      useExitBranching: boolean;
    };
    Hearing_1: {
      frames: {
        duration: number;
        images: number[][];
        exitBranch: number;
      }[];
    };
    Idle1_6: {
      frames: ({
        duration: number;
        images: number[][];
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
      })[];
    };
    WriteReturn: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    Hearing_2: {
      frames: {
        duration: number;
        images: number[][];
        exitBranch: number;
      }[];
    };
    GetAttentionReturn: {
      frames: {
        duration: number;
        images: number[][];
        exitBranch: number;
      }[];
    };
    GestureRight: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
      })[];
      useExitBranching: boolean;
    };
    Think: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
      })[];
      useExitBranching: boolean;
    };
    Blink: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    Write: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    MoveRightReturn: {
      frames: ({
        duration: number;
        images: number[][];
        sound?: undefined;
      } | {
        duration: number;
        images: number[][];
        sound: string;
      })[];
    };
    MoveUpReturn: {
      frames: ({
        duration: number;
        images: number[][];
        sound?: undefined;
      } | {
        duration: number;
        images: number[][];
        sound: string;
      })[];
    };
    Show: {
      frames: ({
        duration: number;
        images: number[][];
        sound?: undefined;
      } | {
        duration: number;
        images: number[][];
        sound: string;
      })[];
    };
    Wave: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
      })[];
      useExitBranching: boolean;
    };
    Searching: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
        branching?: undefined;
      })[];
      useExitBranching: boolean;
    };
    StopListening: {
      frames: {
        duration: number;
        images: number[][];
        exitBranch: number;
      }[];
    };
    MoveDown: {
      frames: ({
        duration: number;
        images: number[][];
        sound?: undefined;
      } | {
        duration: number;
        images: number[][];
        sound: string;
      })[];
    };
    ReadContinued: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    LookDown: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
        branching?: undefined;
      })[];
      useExitBranching: boolean;
    };
    Sad: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
      })[];
      useExitBranching: boolean;
    };
    LookRightReturn: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
      })[];
    };
    MoveDownReturn: {
      frames: ({
        duration: number;
        images: number[][];
        sound?: undefined;
      } | {
        duration: number;
        images: number[][];
        sound: string;
      })[];
    };
    MoveLeftReturn: {
      frames: ({
        duration: number;
        images: number[][];
        sound?: undefined;
      } | {
        duration: number;
        images: number[][];
        sound: string;
      })[];
    };
    GestureDown: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
      })[];
      useExitBranching: boolean;
    };
    Process: {
      frames: {
        duration: number;
        images: number[][];
        exitBranch: number;
      }[];
    };
    RestPose: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    Pleased: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
      })[];
      useExitBranching: boolean;
    };
    MoveUp: {
      frames: ({
        duration: number;
        images: number[][];
        sound?: undefined;
      } | {
        duration: number;
        images: number[][];
        sound: string;
      })[];
    };
  };
};
declare namespace sounds_mp3_d_exports {
  export { _default as default };
}
declare const _default: {
  1: string;
  2: string;
  3: string;
  4: string;
  5: string;
  6: string;
  7: string;
};
//#endregion
export { agent_d_exports as n, sounds_mp3_d_exports as t };