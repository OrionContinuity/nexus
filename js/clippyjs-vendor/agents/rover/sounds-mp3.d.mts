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
        sound?: undefined;
      } | {
        duration: number;
        images: number[][];
        sound: string;
      })[];
    };
    Hide: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    Acknowledge: {
      frames: {
        duration: number;
        images: number[][];
      }[];
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
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
      })[];
    };
    Travel: {
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
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
      })[];
    };
    Cooking: {
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
    Writing: {
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
    GestureLeft: {
      frames: ({
        duration: number;
        images: number[][];
        sound?: undefined;
        branching?: undefined;
      } | {
        duration: number;
        images: number[][];
        sound: string;
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
      })[];
    };
    Surprised: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    Shopping: {
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
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
      })[];
    };
    ImageSearching: {
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
    Celebrity: {
      frames: ({
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
      })[];
    };
    LookUpLeft: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    Greet: {
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
    Idle: {
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
        exitBranch?: undefined;
        sound?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch?: undefined;
        branching?: undefined;
        sound?: undefined;
      } | {
        duration: number;
        images: number[][];
        exitBranch: number;
        branching?: undefined;
        sound?: undefined;
      } | {
        duration: number;
        images: number[][];
        sound: string;
        exitBranch?: undefined;
        branching?: undefined;
      })[];
    };
    HideQuick: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    CharacterSucceeds: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    Sports: {
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
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
      })[];
    };
    Show: {
      frames: {
        duration: number;
        images: number[][];
      }[];
    };
    Money: {
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
    Searching: {
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
    Embarrassed: {
      frames: ({
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
        images: number[][];
        branching?: undefined;
      })[];
    };
    Books: {
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
        branching: {
          branches: {
            frameIndex: number;
            weight: number;
          }[];
        };
      })[];
    };
    LookUp: {
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
    ClickedOn: {
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
    GetAttentionMinor: {
      frames: {
        duration: number;
        images: number[][];
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
  8: string;
  9: string;
  10: string;
};
//#endregion
export { agent_d_exports as n, sounds_mp3_d_exports as t };