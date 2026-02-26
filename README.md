# styleconf_Su
<img width="1912" height="889" alt="image" src="https://github.com/user-attachments/assets/cba45645-e29b-40c9-b590-c93e82813ff1" />

aviutl2の設定ファイル`.conf`のwebエディタ

新しいバージョンのstyle.confに今までの設定をマージするために作りました。

もちろん普通にエディタとしても使えますが、style.conf以外はテストしてないです。

## 特徴
style.conf自体に説明が書いてあるので、それを読んで項目を生成するようにしています。

→ このエディタ自体を更新しなくてもAviUtl2のバージョンアップに着いていけて嬉しい

全体的にGitHub Copilotに書いてもらってます。自分で書いたのはこのREADMEぐらいです。

ありがとうCopilot。

# 使い方
## 普通にエディタとして使う場合
<img width="1907" height="897" alt="image" src="https://github.com/user-attachments/assets/e1219c71-50ef-4d1b-8313-d956c973de5b" />

Openでstyle.confを開くと右にエディタが出てきます。

**編集前に古いstyle.confをバックアップすることを推奨します** (`style.conf-bak`とかにリネームしておく等)

- **編集** 左のテキストでも右のエディタでも編集できます。編集すると反対側にも反映されます。
- **取り消し** 黄色で編集前の値が表示されています。もとに戻したい場合はResetボタンを押してください。
- **位置の同期** 行番号をクリックすると反対側にも同じ項目が表示されます。
- **編集履歴** Undo/Redoだけでなく、履歴一覧から任意の編集点まで戻れます。

変更が終わったらSaveしてください。

## 設定のマージ

<img width="1912" height="889" alt="image" src="https://github.com/user-attachments/assets/cba45645-e29b-40c9-b590-c93e82813ff1" />

- Openで使用しているデフォルト設定のstyle.conf(aviUtl2.exeと同じ階層)を開く。こっちを`New`と呼ぶ。
- Open Old style.confからユーザー設定のstyle.conf(`ProgramData\AviUtl2\` or `<aviutl2があるフォルダ>\data\` の中) を開く。こっちを`Old`と呼ぶ。
- Mergeボタンを押して、NewかOldかどちらの設定を残したいか選択し、Applyボタンを押すとNew側に反映される。

ユーザー設定のstyle.confのバージョンを使用しているもの(最新版)に合わせるのに使えると思います。  その場合はOldを残す(All Oldボタン)形でマージするとうまくいきます。

# VSCodeとかでよくね？
はい

# 免責事項
開発者はこのツールによる影響に関して一切の責任を負いません。

**バックアップは必ず実施してください。**

ただし、誠実な対応に向けて善処する方針です。ご連絡は本リポジトリ・Discord・Xなどからお願いします。
