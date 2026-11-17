{
  description = "beastx-ctl: WLMouse Beast X 4K configurator and protocol recovery workspace";

  inputs.nixpkgs.url = "nixpkgs";

  outputs =
    { nixpkgs, ... }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      jdk = pkgs.jdk25;
      cccc = pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
        pname = "cccc";
        version = "1.8.0";
        src = pkgs.fetchurl {
          url = "https://github.com/moznion/cccc/releases/download/v${finalAttrs.version}/cccc-v${finalAttrs.version}-x86_64-unknown-linux-musl.tar.gz";
          hash = "sha256-A1ARHjtknDJ+YsmdoKNcd/ZYhPXkJ5qWj0Nx9zpqVIA=";
        };
        dontUnpack = true;
        installPhase = ''
          runHook preInstall
          mkdir -p "$out/bin"
          tar xzf "$src" -C "$TMPDIR"
          install -m755 "$TMPDIR/cccc" "$out/bin/cccc"
          runHook postInstall
        '';
        meta = {
          description = "Measure cognitive and cyclomatic complexity across languages";
          homepage = "https://github.com/moznion/cccc";
          license = pkgs.lib.licenses.mit;
          mainProgram = "cccc";
          platforms = [ "x86_64-linux" ];
          sourceProvenance = [ pkgs.lib.sourceTypes.binaryNativeCode ];
        };
      });
      rea = pkgs.writeShellApplication {
        name = "rea";
        runtimeInputs = [
          pkgs.util-linux
          pkgs.coreutils
        ];
        text = ''
          root="''${REA_ROOT:-$HOME/.local/share/rea/6.9.0}"
          lockdir="''${XDG_CACHE_HOME:-$HOME/.cache}/rea"
          mkdir -p "$lockdir"

          export JAVA_HOME="${jdk}/lib/openjdk"
          export GHIDRA_INSTALL_DIR="${pkgs.ghidra}/lib/ghidra"
          export GHIDRA_HEADLESS_MAXMEM="''${GHIDRA_HEADLESS_MAXMEM:-2G}"
          export JDK_JAVA_OPTIONS="''${JDK_JAVA_OPTIONS:--XX:ActiveProcessorCount=3}"

          node="${pkgs.nodejs_26}/bin/node"
          run=("$node" "$root/scripts/rea.mjs" "$@")
          limits=(-p MemoryHigh=5G -p MemoryMax=7G -p MemorySwapMax=1G -p CPUQuota=300% -p TasksMax=512)

          if [ "''${1:-}" != "mcp" ]; then
            run=(flock -w 3600 "$lockdir/cli.lock" nice -n 10 "''${run[@]}")
          else
            run=(nice -n 10 "''${run[@]}")
          fi

          if [ -z "''${REA_NO_SCOPE:-}" ] && systemd-run --user --scope --quiet true 2>/dev/null; then
            exec systemd-run --user --scope --quiet --collect "''${limits[@]}" "''${run[@]}"
          fi
          exec "''${run[@]}"
        '';
      };
    in
    {
      packages.${system} = {
        inherit rea;
        default = rea;
      };

      devShells.${system}.default = pkgs.mkShell {
        packages = [
          rea
          pkgs.bun
          pkgs.nodejs_26
          pkgs.lefthook
          cccc
        ];
      };
    };
}
