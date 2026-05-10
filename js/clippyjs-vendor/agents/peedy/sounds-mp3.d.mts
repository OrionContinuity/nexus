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
      useExitBranching: boolean;
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
    LookUpRightBlink: {
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
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
        exitBranch?: undefined;
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
    Explain: {
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
    Decline: {
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
    DontRecognize: {
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
    Idle3_3: {
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
      })[];
    };
    ReadReturn: {
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
    LookDownLeftBlink: {
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
    Idle2_2: {
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
        exitBranch?: undefined;
        sound?: undefined;
        branching?: undefined;
      })[];
    };
    Announce: {
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
    GetAttention: {
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
    Surprised: {
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
    Idle1_5: {
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
    Idle1_4: {
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
    LookRight: {
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
    GestureUp: {
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
    Idle1_1: {
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
      })[];
    };
    Idle1_2: {
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
    Read: {
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
    Processing: {
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
    DoMagic1: {
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
    Confused: {
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
    LookUpRight: {
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
    LookUpRightReturn: {
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
        images: number[][];
        exitBranch: number;
        sound: string;
        branching?: undefined;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
        sound?: undefined;
        branching?: undefined;
      })[];
    };
    GetAttentionContinued: {
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
    LookRightBlink: {
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
        exitBranch?: undefined;
        sound?: undefined;
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
    Search: {
      frames: ({
        duration: number;
        images: number[][];
        branching?: undefined;
        sound?: undefined;
        exitBranch?: undefined;
      } | {
        duration: number;
        images: number[][];
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
        sound?: undefined;
        exitBranch?: undefined;
      } | {
        duration: number;
        images: number[][];
        sound: string;
        branching?: undefined;
        exitBranch?: undefined;
      } | {
        duration: number;
        images: number[][];
        sound: string;
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
        exitBranch?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        branching?: undefined;
        sound?: undefined;
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
    LookDownBlink: {
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
        exitBranch?: undefined;
        sound?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
        sound?: undefined;
        branching?: undefined;
      })[];
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
    LookDownRightReturn: {
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
    LookUpLeft: {
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
        images: number[][];
        exitBranch?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
        branching?: undefined;
      })[];
      useExitBranching: boolean;
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
        images?: undefined;
        exitBranch?: undefined;
        branching?: undefined;
      })[];
      useExitBranching: boolean;
    };
    LookDownLeftReturn: {
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
    LookUpLeftBlink: {
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
        images?: undefined;
        exitBranch?: undefined;
        branching?: undefined;
      })[];
      useExitBranching: boolean;
    };
    GetAttentionReturn: {
      frames: {
        duration: number;
        images: number[][];
      }[];
      useExitBranching: boolean;
    };
    GestureRight: {
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
    LookUpBlink: {
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
    LookUpLeftReturn: {
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
        images: number[][];
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
        exitBranch?: undefined;
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
        exitBranch?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
      })[];
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
    LookDownRight: {
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
    Show: {
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
    ReadContinued: {
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
    Process: {
      frames: ({
        duration: number;
        images: number[][];
        sound?: undefined;
        branching?: undefined;
        exitBranch?: undefined;
      } | {
        duration: number;
        images: number[][];
        sound: string;
        branching?: undefined;
        exitBranch?: undefined;
      } | {
        duration: number;
        images: number[][];
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
        sound?: undefined;
        exitBranch?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        sound?: undefined;
        branching?: undefined;
      })[];
    };
    LookLeftBlink: {
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
    LookDownLeft: {
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
    LookDownRightBlink: {
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
    RestPose: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    Searching: {
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
  15: string;
  16: string;
  17: string;
  18: string;
  19: string;
  20: string;
  21: string;
  22: string;
  23: string;
  24: string;
  25: string;
  26: string;
  27: string;
  28: string;
  29: string;
  30: string;
};
//#endregion
export { agent_d_exports as n, sounds_mp3_d_exports as t };