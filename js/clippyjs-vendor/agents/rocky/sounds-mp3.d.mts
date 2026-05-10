declare namespace agent_d_exports {
  export { _default$1 as default };
}
declare const _default$1: {
  overlayCount: number;
  sounds: string[];
  framesize: number[];
  animations: {
    DeepIdle1: {
      frames: ({
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
        images: number[][];
        exitBranch: number;
        branching?: undefined;
      })[];
    };
    Congratulate: {
      frames: ({
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
        sound?: undefined;
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
        sound: string;
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
        sound?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        sound: string;
        branching?: undefined;
      })[];
    };
    "Idle(1)": {
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
    Hide: {
      frames: ({
        duration: number;
        images: number[][];
      } | {
        duration: number;
        images?: undefined;
      })[];
    };
    SendMail: {
      frames: ({
        duration: number;
        images: number[][];
        sound: string;
        exitBranch?: undefined;
      } | {
        duration: number;
        images: number[][];
        sound?: undefined;
        exitBranch?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        sound?: undefined;
      })[];
    };
    Thinking: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch?: undefined;
        branching?: undefined;
      } | {
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
      })[];
    };
    "Idle(3)": {
      frames: ({
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
        images: number[][];
        branching?: undefined;
        exitBranch?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        branching?: undefined;
      })[];
    };
    Explain: {
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
        exitBranch?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        branching?: undefined;
      })[];
    };
    "Idle(5)": {
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
        exitBranch?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        branching?: undefined;
      })[];
    };
    Print: {
      frames: ({
        duration: number;
        images: number[][];
        sound: string;
        exitBranch?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        sound?: undefined;
        exitBranch?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
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
        images: number[][];
        exitBranch: number;
        sound: string;
        branching?: undefined;
      })[];
    };
    LookRight: {
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
    GetAttention: {
      frames: ({
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
        sound: string;
        exitBranch?: undefined;
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
        sound?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        sound: string;
        branching?: undefined;
      })[];
    };
    Save: {
      frames: ({
        duration: number;
        images: number[][];
        sound: string;
        exitBranch?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        sound?: undefined;
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
        sound?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        sound?: undefined;
        branching?: undefined;
      })[];
    };
    GetTechy: {
      frames: ({
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
        images: number[][];
        exitBranch: number;
        branching?: undefined;
      })[];
    };
    GestureUp: {
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
    Idle1_1: {
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
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
        images?: undefined;
        exitBranch?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        branching?: undefined;
      } | {
        duration: number;
        images?: undefined;
        exitBranch?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
        exitBranch: number;
        images?: undefined;
      })[];
    };
    Processing: {
      frames: ({
        duration: number;
        images: number[][];
        sound: string;
        branching?: undefined;
        exitBranch?: undefined;
      } | {
        duration: number;
        images: number[][];
        sound?: undefined;
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
        sound?: undefined;
        branching?: undefined;
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
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
        sound?: undefined;
      })[];
    };
    Alert: {
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
        exitBranch?: undefined;
        branching?: undefined;
      })[];
    };
    LookUpRight: {
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
    "Idle(9)": {
      frames: ({
        duration: number;
        images: number[][];
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
        exitBranch?: undefined;
      } | {
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
      })[];
    };
    "Idle(7)": {
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
        exitBranch?: undefined;
        branching?: undefined;
      })[];
    };
    GestureDown: {
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
    LookLeft: {
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
    "Idle(2)": {
      frames: ({
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
        branching?: undefined;
        exitBranch?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        branching?: undefined;
      })[];
    };
    LookUpLeft: {
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
    CheckingSomething: {
      frames: ({
        duration: number;
        images: number[][];
        sound: string;
        exitBranch?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        sound?: undefined;
        exitBranch?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
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
      })[];
    };
    Hearing_1: {
      frames: ({
        duration: number;
        images: number[][];
        sound: string;
        exitBranch?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        sound?: undefined;
        exitBranch?: undefined;
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
        sound?: undefined;
        branching?: undefined;
      })[];
    };
    GetWizardy: {
      frames: ({
        duration: number;
        images: number[][];
        exitBranch: number;
        sound: string;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        sound?: undefined;
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
        sound: string;
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
        sound?: undefined;
      })[];
    };
    GestureLeft: {
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
    Wave: {
      frames: ({
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
        sound?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
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
        images: number[][];
        sound: string;
        exitBranch?: undefined;
        branching?: undefined;
      })[];
    };
    Goodbye: {
      frames: ({
        duration: number;
        images: number[][];
        sound: string;
        branching?: undefined;
        exitBranch?: undefined;
      } | {
        duration: number;
        images: number[][];
        sound?: undefined;
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
      } | {
        duration: number;
        images?: undefined;
        sound?: undefined;
        branching?: undefined;
        exitBranch?: undefined;
      })[];
    };
    GestureRight: {
      frames: ({
        duration: number;
        images: number[][];
        sound: string;
        exitBranch?: undefined;
      } | {
        duration: number;
        images: number[][];
        sound?: undefined;
        exitBranch?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        sound?: undefined;
      })[];
    };
    Writing: {
      frames: ({
        duration: number;
        images: number[][];
        sound: string;
        exitBranch?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        sound?: undefined;
        exitBranch?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
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
        images: number[][];
        exitBranch: number;
        sound: string;
        branching?: undefined;
      })[];
    };
    LookDownRight: {
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
    GetArtsy: {
      frames: ({
        duration: number;
        images: number[][];
        sound: string;
        exitBranch?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        sound?: undefined;
        exitBranch?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
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
      })[];
    };
    Show: {
      frames: ({
        duration: number;
        images?: undefined;
      } | {
        duration: number;
        images: number[][];
      })[];
    };
    LookDown: {
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
    Searching: {
      frames: ({
        duration: number;
        images: number[][];
        sound: string;
        exitBranch?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        sound?: undefined;
        exitBranch?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
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
      })[];
    };
    "Idle(4)": {
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
        exitBranch?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        branching?: undefined;
      })[];
    };
    EmptyTrash: {
      frames: ({
        duration: number;
        images: number[][];
        sound: string;
        exitBranch?: undefined;
      } | {
        duration: number;
        images: number[][];
        sound?: undefined;
        exitBranch?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        sound?: undefined;
      })[];
    };
    Greeting: {
      frames: ({
        duration: number;
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
        sound: string;
        images?: undefined;
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
        exitBranch: number;
        branching?: undefined;
        sound?: undefined;
      })[];
    };
    LookUp: {
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
    "Idle(6)": {
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
    RestPose: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    "Idle(8)": {
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
    LookDownLeft: {
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
  31: string;
  32: string;
  33: string;
  34: string;
};
//#endregion
export { agent_d_exports as n, sounds_mp3_d_exports as t };