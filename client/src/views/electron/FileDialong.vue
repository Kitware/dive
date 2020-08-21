<template>
  <v-layout row wrap>
    <v-flex sm12>
      <v-card dark color="secondary">
        <v-card-text class="px-0">
          <v-btn color="primary" @click="openFile()">Open File</v-btn>
          <v-btn color="primary" @click="saveFile()">Save File</v-btn>
          <v-flex sm6 offset-sm3>
            <v-text-field
              v-model="textAreaValue"
              textarea
              name="editor"
              label="this is a placeholder"
              id="editor">
            </v-text-field>
          </v-flex>
        </v-card-text>
      </v-card>
    </v-flex>
  </v-layout>
</template>

<script>
const { dialog } = require("electron").remote;
export default {
  data() {
    return {
      textAreaValue: ""
    }
  },
  methods: {
    saveFile() {
      dialog.showSaveDialog(
        {
          filters: [
            {
              name: "text",
              extensions: ["txt"]
            }
          ]
        },
        function(fileName) {
          if (fileName === undefined) return;
          
          fs.writeFile(
            fileName,
            document.getElementById("editor").value,
            function(err) {
              if (err !== undefined) {
                dialog.showMessageBox({
                  message: "The file has been saved! :-)",
                  buttons: ["OK"]
                });
              } else {
                dialog.showErrorBox("File Save Error", err.message);
              }
            }
          );
        }
      );
    },
    openFile() {
      let self = this;
      dialog.showOpenDialog(
        {
          filters: [
            {
              name: "text",
              extensions: ["txt"]
            }
          ]
        },
        function(fileNames) {
          if (fileNames === undefined) return;
          
          var fileName = fileNames[0];
          fs.readFile(fileName, "utf-8", function(err, data) {
            self.textAreaValue = data;
          });
        }
      );
    }  
}
</script>
