var LEFT = 37
var RIGHT = 39
var UP = 38
var DOWN = 40

onmessage = function (evt) {
    if(evt.data[0] === 'checkWall'){
        switch(evt.data[1]) {
        case LEFT:
          if(0 <= evt.data[3].left) {
              message = ["wall", "ok"];
          } else {
              message = ["wall", "boom"];
          }
          break;
        case RIGHT:
          if(evt.data[2].width > evt.data[3].left) {
              message = ["wall", "ok"];
          } else {
              message = ["wall", "boom"];
          }
          break;
        case UP:
          if(0 <= evt.data[3].top) {
              message = ["wall", "ok"];
          } else {
              message = ["wall", "boom"];
          }
          break;
        case DOWN:
          if(evt.data[2].height > evt.data[3].top) {
              message = ["wall", "ok"];
          } else {
              message = ["wall", "boom"];
          }
          break;
        default:
          //code to be executed if n is different from case 1 and 2
        }
        postMessage(message);
    } else {
        postMessage('dont know how to process this');
    }
};
