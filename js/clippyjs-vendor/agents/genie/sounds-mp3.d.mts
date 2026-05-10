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
        exitBranch: number;
        sound?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        sound: string;
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
        sound?: undefined;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
        sound?: undefined;
        branching?: undefined;
      })[];
      useExitBranching: boolean;
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
        images?: undefined;
        exitBranch?: undefined;
        sound?: undefined;
      })[];
    };
    Hide: {
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
        images?: undefined;
        exitBranch?: undefined;
        sound?: undefined;
      })[];
    };
    Pleased: {
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
    Acknowledge: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
      } | {
        duration: number;
        images: number[][];
        exitBranch?: undefined;
      })[];
    };
    Thinking: {
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
    Suggest: {
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
    DontRecognize: {
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
    Writing: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
        sound?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        sound: string;
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
        sound?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        sound: string;
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
        sound?: undefined;
        branching?: undefined;
      })[];
      useExitBranching: boolean;
    };
    Write: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
        sound?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        sound: string;
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        sound: string;
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
        sound?: undefined;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
        sound?: undefined;
        branching?: undefined;
      })[];
    };
    Idle3_2: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
        branching?: undefined;
        sound?: undefined;
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
        sound?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        sound: string;
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
        sound?: undefined;
      })[];
      useExitBranching: boolean;
    };
    Idle3_1: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
        branching?: undefined;
        sound?: undefined;
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
        sound?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        sound: string;
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
      } | {
        duration: number;
        images: number[][];
        exitBranch?: undefined;
        branching?: undefined;
        sound?: undefined;
      })[];
    };
    Congratulate_2: {
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
    StartListening: {
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
    Idle2_3: {
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
    Idle2_2: {
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
    Announce: {
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
    GetAttention: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
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
        exitBranch?: undefined;
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
        exitBranch?: undefined;
      })[];
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
    Idle1_5: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch?: undefined;
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
    Idle1_4: {
      frames: ({
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
        images: number[][];
        exitBranch: number;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch?: undefined;
        branching?: undefined;
      })[];
    };
    LookLeftReturn: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
      } | {
        duration: number;
        images: number[][];
        exitBranch?: undefined;
      })[];
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
        exitBranch?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
      })[];
    };
    Idle1_3: {
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
    Idle1_2: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
      } | {
        duration: number;
        images: number[][];
        exitBranch?: undefined;
      })[];
    };
    Read: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
        sound?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        sound: string;
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
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
        sound?: undefined;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
        sound?: undefined;
        branching?: undefined;
      })[];
    };
    Processing: {
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
    Wave: {
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
    DoMagic1: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
      })[];
    };
    DoMagic2: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
        branching?: undefined;
        sound?: undefined;
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
        sound?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        sound: string;
        branching?: undefined;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
        branching?: undefined;
        sound?: undefined;
      })[];
      useExitBranching: boolean;
    };
    LookRight: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
      } | {
        duration: number;
        images: number[][];
        exitBranch?: undefined;
      })[];
    };
    Alert: {
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
    MoveRight: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
        sound?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        sound: string;
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
        sound?: undefined;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
        sound?: undefined;
        branching?: undefined;
      })[];
      useExitBranching: boolean;
    };
    Reading: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
        sound?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        sound: string;
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
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
        sound?: undefined;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
        sound?: undefined;
        branching?: undefined;
      })[];
      useExitBranching: boolean;
    };
    GetAttentionContinued: {
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
    };
    WriteContinued: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
        sound?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        sound: string;
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
        sound?: undefined;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
        sound?: undefined;
        branching?: undefined;
      })[];
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
    LookRightBlink: {
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
    };
    Search: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
      } | {
        duration: number;
        images: number[][];
        exitBranch?: undefined;
      })[];
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
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
      })[];
    };
    LookDownReturn: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
      } | {
        duration: number;
        images: number[][];
        exitBranch?: undefined;
      })[];
    };
    Hearing_4: {
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
        images: number[][];
        exitBranch?: undefined;
        branching?: undefined;
      })[];
    };
    LookUpReturn: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
      } | {
        duration: number;
        images: number[][];
        exitBranch?: undefined;
      })[];
    };
    Hearing_1: {
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
        images: number[][];
        exitBranch?: undefined;
        branching?: undefined;
      })[];
      useExitBranching: boolean;
    };
    Greet: {
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
    Hearing_3: {
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
        images: number[][];
        exitBranch?: undefined;
        branching?: undefined;
      })[];
      useExitBranching: boolean;
    };
    Idle1_6: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
      } | {
        duration: number;
        images: number[][];
        exitBranch?: undefined;
      })[];
    };
    WriteReturn: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
      } | {
        duration: number;
        images: number[][];
        exitBranch?: undefined;
      })[];
    };
    Hearing_2: {
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
        images: number[][];
        exitBranch?: undefined;
        branching?: undefined;
      })[];
      useExitBranching: boolean;
    };
    GetAttentionReturn: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
      } | {
        duration: number;
        images: number[][];
        exitBranch?: undefined;
      })[];
    };
    RestPose: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    LookDownBlink: {
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
    };
    LookUpBlink: {
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
    };
    Think: {
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
    Blink: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
      } | {
        duration: number;
        images: number[][];
        exitBranch?: undefined;
      })[];
    };
    Show: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
        sound: string;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        sound?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch?: undefined;
        sound?: undefined;
      })[];
    };
    LookRightReturn: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
      } | {
        duration: number;
        images: number[][];
        exitBranch?: undefined;
      })[];
    };
    StopListening: {
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
    MoveDown: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
        sound?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        sound: string;
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
        sound?: undefined;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
        sound?: undefined;
        branching?: undefined;
      })[];
      useExitBranching: boolean;
    };
    ReadContinued: {
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
    };
    LookDown: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
      })[];
    };
    Sad: {
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
      } | {
        duration: number;
        images?: undefined;
        branching?: undefined;
      })[];
    };
    Process: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
      })[];
    };
    LookUp: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
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
    ReadReturn: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
      } | {
        duration: number;
        images: number[][];
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
    MoveUp: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
        sound?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        sound: string;
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
        sound?: undefined;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
        sound?: undefined;
        branching?: undefined;
      })[];
      useExitBranching: boolean;
    };
    LookLeftBlink: {
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
  8: string;
  9: string;
  10: string;
  11: string;
  12: string;
  13: string;
  14: string;
};
//#endregion
export { agent_d_exports as n, sounds_mp3_d_exports as t };