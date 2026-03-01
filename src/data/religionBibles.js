export const RELIGION_BIBLES = {
  Solaris: {
    name: "Solaris",
    scriptureTitle: "光環の書",
    doctrine: "秩序・勤勉・共同規範を重視",
    modifiers: { workEthic: 0.16, socialBond: 0.06, familyPriority: 0.08, riskNorm: -0.05 },
    chapters: [
      {
        title: "第一章 光の秩序",
        text: "世界は混沌から生まれ、秩序によって育つ。人は働きによって自らを磨き、共同体によって光を保つ。"
      },
      {
        title: "第二章 三つの誓い",
        text: "毎日ひとつの役目を果たし、約束を守り、弱き者を見捨てず共同体の調和を守る。"
      },
      {
        title: "第三章 罪と償い",
        text: "怠惰・虚言・裏切りは共同体の光を曇らせる。過ちを認め、労働と奉仕で償う者は再び光に迎えられる。"
      },
      {
        title: "第四章 祝詞",
        text: "光は我らの手に宿る。秩序は我らの歩みに宿る。"
      }
    ]
  },
  River: {
    name: "River",
    scriptureTitle: "流紋の書",
    doctrine: "相互扶助・流動性・調和を重視",
    modifiers: { workEthic: 0.05, socialBond: 0.16, familyPriority: 0.06, riskNorm: 0.02 },
    chapters: [
      {
        title: "第一章 流れの真理",
        text: "すべては流れ、変わり、巡る。人は互いに支え合うことで濁りを澄みに変える。"
      },
      {
        title: "第二章 四つの徳",
        text: "聴くこと、分かち合うこと、許し合うこと、新しい流れを恐れぬこと。"
      },
      {
        title: "第三章 共同の掟",
        text: "飢えた者には食を、孤独な者には席を、悲しむ者には言葉を。助けを拒まず、助けを恥じない。"
      },
      {
        title: "第四章 祈り",
        text: "流れよ、滞りを解き、我らを再び結びたまえ。"
      }
    ]
  },
  Stone: {
    name: "Stone",
    scriptureTitle: "礎の書",
    doctrine: "伝統・結束・安定を重視",
    modifiers: { workEthic: 0.09, socialBond: 0.1, familyPriority: 0.18, riskNorm: -0.08 },
    chapters: [
      {
        title: "第一章 礎の教え",
        text: "家族と伝統は風雪に耐える石壁である。節度ある継承は国を強くする。"
      },
      {
        title: "第二章 五つの柱",
        text: "祖先を敬い、家族を守り、約を重んじ、技を継ぎ、共同体の安定を最優先する。"
      },
      {
        title: "第三章 禁戒",
        text: "無責任・放縦・恩忘れは礎を崩す。争いは最後の手段とし、まず対話と仲裁を尽くす。"
      },
      {
        title: "第四章 誓句",
        text: "石は沈黙して語る。守るべきものを守れ。"
      }
    ]
  },
  Free: {
    name: "Free",
    scriptureTitle: "風界の書",
    doctrine: "自律・多様性・挑戦を重視",
    modifiers: { workEthic: 0.03, socialBond: 0.08, familyPriority: -0.02, riskNorm: 0.14 },
    chapters: [
      {
        title: "第一章 自律の宣言",
        text: "人は生まれながらに選ぶ力を持つ。多様な道は世界を豊かにする共鳴である。"
      },
      {
        title: "第二章 自由の責任",
        text: "選択は他者の自由を侵さず、挑戦を恐れず、異なる価値観を対話で磨く。"
      },
      {
        title: "第三章 創造の掟",
        text: "新しい思想・技術・表現を歓迎せよ。失敗は罪ではなく、停滞こそ最大の損失である。"
      },
      {
        title: "第四章 合言葉",
        text: "風は境界を知らない。ゆえに我らも閉じない。"
      }
    ]
  }
};

export const RELIGION_NAMES = Object.keys(RELIGION_BIBLES);
