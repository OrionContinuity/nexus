declare namespace agent_d_exports {
  export { _default$1 as default };
}
declare const _default$1: {
  overlayCount: number;
  sounds: string[];
  framesize: number[];
  animations: {
    IdleTailWagA: {
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
    Congratulate: {
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
    IdleTailWagC: {
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
    IdleScratch: {
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
    Hide: {
      frames: ({
        duration: number;
        images: number[][];
      } | {
        duration: number;
        images?: undefined;
      })[];
    };
    IdleTailWagD: {
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
    SendMail: {
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
        images: number[][];
        exitBranch?: undefined;
        branching?: undefined;
      })[];
    };
    Explain: {
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
    Save: {
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
    IdleTailWagB: {
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
    IdleBlink: {
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
        exitBranch?: undefined;
        branching?: undefined;
      })[];
    };
    Print: {
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
        sound: string;
      })[];
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
    GetAttention: {
      frames: ({
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
    Alert: {
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
    GetTechy: {
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
      })[];
    };
    GestureUp: {
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
      })[];
    };
    Processing: {
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
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
        sound?: undefined;
        exitBranch?: undefined;
      })[];
    };
    IdleStretch: {
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
    LookUpRight: {
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
    DeepIdleE: {
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
    IdleButterFly: {
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
    IdleTwitch: {
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
    GoodBye: {
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
      } | {
        duration: number;
        images?: undefined;
        sound?: undefined;
        exitBranch?: undefined;
      })[];
    };
    LookLeft: {
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
        images: number[][];
        exitBranch?: undefined;
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
      })[];
    };
    Hearing_1: {
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
    GetWizardy: {
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
    GestureLeft: {
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
    Wave: {
      frames: ({
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
    GestureRight: {
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
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
        sound?: undefined;
        exitBranch?: undefined;
      })[];
    };
    IdleCleaning: {
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
    LookDownRight: {
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
    GetArtsy: {
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
        exitBranch: number;
      } | {
        duration: number;
        images: number[][];
        exitBranch?: undefined;
      })[];
    };
    IdleLegLick: {
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
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
        exitBranch?: undefined;
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
      })[];
    };
    DeepIdleA: {
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
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
        sound?: undefined;
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
        images?: undefined;
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
        branching?: undefined;
        sound?: undefined;
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
    IdleYawn: {
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
    LookUp: {
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
    GestureDown: {
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
    LookDownLeft: {
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
};
//#endregion
export { agent_d_exports as n, sounds_mp3_d_exports as t };