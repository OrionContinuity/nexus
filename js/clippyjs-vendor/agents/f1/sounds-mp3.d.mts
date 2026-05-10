declare namespace agent_d_exports {
  export { _default$1 as default };
}
declare const _default$1: {
  overlayCount: number;
  sounds: string[];
  framesize: number[];
  animations: {
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
    IdleLookDown: {
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
    Thinking: {
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
        sound: string;
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
        exitBranch: number;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch?: undefined;
        branching?: undefined;
      })[];
    };
    IdleCuteToeTwist: {
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
    IdleLowersBrows: {
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
    IdleBlink: {
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
        sound?: undefined;
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
    GetAttention: {
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
    IdleHeadPatting: {
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
        images: number[][];
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
    Hearing_1: {
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
        sound: string;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        sound?: undefined;
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
        sound: string;
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
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
        sound?: undefined;
      })[];
    };
    IdleBlinkWithBrows: {
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
    GestureLeft: {
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
    Goodbye: {
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
      } | {
        duration: number;
        images?: undefined;
        sound?: undefined;
        exitBranch?: undefined;
        branching?: undefined;
      })[];
    };
    GestureRight: {
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
      })[];
    };
    IdleLeansAgainstWall: {
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
    IdleLooksAtUser: {
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
    IdleLookRight: {
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
      })[];
    };
    IdleFallsAsleep: {
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
        sound?: undefined;
        branching?: undefined;
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
    IdleLowersToGround: {
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
        images: number[][];
        exitBranch: number;
        sound?: undefined;
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
        sound: string;
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
    Greeting: {
      frames: ({
        duration: number;
        sound: string;
        images?: undefined;
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
        sound?: undefined;
        branching?: undefined;
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
    GestureDown: {
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
    IdleLookLeft: {
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
};
//#endregion
export { agent_d_exports as n, sounds_mp3_d_exports as t };